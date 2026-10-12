import "../src/lib/installTruncationGuard";
/**
 * 경제 일정 공식 출처 수집 → Storage(market-snapshots/economic-calendar/official.json)
 *
 * 하드코딩 일정(src/utils/fetchEconomicCalendar.ts)이 끝나면 경고·매수 제한이 조용히 사라지던 문제를
 * 사람 손 없이 막기 위한 배치. 출처별로 저장하고, 한 출처가 실패하면 그 출처는 이전 결과를 유지한 채
 * ok=false로 남긴다(무결성 점검이 알린다). 실패가 있으면 종료 코드 1 — GitHub Actions 실패 메일이 간다.
 *
 * 사용: pnpm exec tsx scripts/economic_calendar_sync.ts [--dryRun=true]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  SYNCED_CALENDAR_BUCKET,
  SYNCED_CALENDAR_PATH,
  parseBeaSchedule,
  parseBlsSchedule,
  parseBokSchedule,
  parseFedCalendar,
  type SyncedCalendarFile,
  type SyncedEvent,
} from "../src/lib/economicCalendarSources";

const DRY_RUN = process.argv.includes("--dryRun=true");
// BLS는 브라우저 흉내·curl·URL이 들어간 User-Agent를 403으로 막고, 이름만 밝히면 받아 준다 (2026-10-12 확인)
const USER_AGENT = "nexora-calendar-bot/1.0";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

type SourceSpec = {
  key: string;
  load: () => Promise<SyncedEvent[]>;
  /** 이보다 적게 나오면 페이지 구조가 바뀐 것으로 보고 실패 처리 (0이 정상일 수 있는 다음 해 일정은 0) */
  minEvents: number;
};

const kstYear = Number(new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 4));
const BOK_URL = (year: number) =>
  `https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755&pYear=${year}`;

const SOURCES: SourceSpec[] = [
  { key: "bls-cpi", minEvents: 6, load: async () => parseBlsSchedule(await fetchText("https://www.bls.gov/schedule/news_release/cpi.htm"), "us-cpi") },
  { key: "bls-ppi", minEvents: 6, load: async () => parseBlsSchedule(await fetchText("https://www.bls.gov/schedule/news_release/ppi.htm"), "us-ppi") },
  { key: "bls-nfp", minEvents: 6, load: async () => parseBlsSchedule(await fetchText("https://www.bls.gov/schedule/news_release/empsit.htm"), "us-nfp") },
  { key: "bea-this-year", minEvents: 1, load: async () => parseBeaSchedule(await fetchText("https://www.bea.gov/news/schedule")) },
  { key: "bea-next-year", minEvents: 0, load: async () => parseBeaSchedule(await fetchText("https://www.bea.gov/news/schedule/next-year")) },
  { key: "fed-fomc", minEvents: 8, load: async () => parseFedCalendar(await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")) },
  { key: "bok-this-year", minEvents: 6, load: async () => parseBokSchedule(await fetchText(BOK_URL(kstYear)), kstYear) },
  { key: "bok-next-year", minEvents: 0, load: async () => parseBokSchedule(await fetchText(BOK_URL(kstYear + 1)), kstYear + 1) },
];

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  let previous: SyncedCalendarFile | null = null;
  const { data: prevBlob, error: prevError } = await supabase.storage
    .from(SYNCED_CALENDAR_BUCKET)
    .download(SYNCED_CALENDAR_PATH, { cacheNonce: String(Date.now()) });
  if (prevBlob) previous = JSON.parse(await prevBlob.text()) as SyncedCalendarFile;
  else if (prevError && !/not found|404|Object not found/i.test(prevError.message)) {
    // 일시 오류를 "파일 없음"으로 보고 덮어쓰면 다른 출처의 이전 결과가 지워진다
    throw new Error(`이전 일정 파일 읽기 실패: ${prevError.message}`);
  }

  const now = new Date().toISOString();
  const file: SyncedCalendarFile = { generatedAt: now, sources: {} };
  const failures: string[] = [];

  for (const spec of SOURCES) {
    const prev = previous?.sources?.[spec.key];
    try {
      const events = await spec.load();
      if (events.length < spec.minEvents) throw new Error(`일정 ${events.length}건 (최소 ${spec.minEvents}) — 페이지 구조가 바뀌었을 수 있음`);
      file.sources[spec.key] = { fetchedAt: now, ok: true, events };
      console.log(`✅ ${spec.key}: ${events.length}건 (${events[0]?.date ?? "-"} ~ ${events[events.length - 1]?.date ?? "-"})`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failures.push(`${spec.key}: ${error}`);
      file.sources[spec.key] = { fetchedAt: prev?.fetchedAt ?? now, ok: false, error, events: prev?.events ?? [] };
      console.error(`❌ ${spec.key}: ${error} (이전 결과 ${prev?.events.length ?? 0}건 유지)`);
    }
  }

  if (DRY_RUN) {
    console.log("[dryRun] 저장하지 않음");
  } else {
    const { error } = await supabase.storage
      .from(SYNCED_CALENDAR_BUCKET)
      .upload(SYNCED_CALENDAR_PATH, JSON.stringify(file), { upsert: true, contentType: "application/json", cacheControl: "0" });
    if (error) throw new Error(`일정 파일 저장 실패: ${error.message}`);
    console.log(`저장: ${SYNCED_CALENDAR_BUCKET}/${SYNCED_CALENDAR_PATH}`);
  }

  if (failures.length) {
    console.error(`실패 ${failures.length}건:\n${failures.join("\n")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
