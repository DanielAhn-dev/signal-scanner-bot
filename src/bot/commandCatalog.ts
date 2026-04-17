export type PromptKind =
  | "trade"
  | "finance"
  | "news"
  | "flow"
  | "capital"
  | "etfinfo"
  | "etfdiv";

export type PromptPreset = {
  kind: PromptKind;
  title: string;
  placeholder: string;
  replyPrefix: string;
  replyHints: string[];
};

export type TelegramBotCommand = {
  command: string;
  description: string;
};

const CALLBACK_COMMAND_TEXT: Record<string, string> = {
  brief: "/brief",
  market: "/market",
  economy: "/economy",
  sector: "/sector",
  nextsector: "/nextsector",
  pullback: "/pullback",
  onboarding: "/onboarding",
  watchlist: "/watchlist",
  profile: "/profile",
  scan: "/scan",
  flow: "/flow",
  ranking: "/ranking",
  feed: "/feed",
  kospi: "/kospi",
  kosdaq: "/kosdaq",
  etf: "/etf",
  alert: "/alert",
  help: "/help",
};

const CALLBACK_PREFIX_TEXT: Record<string, string> = {
  trade: "/trade",
  finance: "/finance",
  news: "/news",
  etfinfo: "/etfinfo",
  etfdiv: "/etfdiv",
  watchadd: "/watchadd",
};

const HELP_SECTIONS = [
  {
    title: "빠른 시작",
    lines: [
      "/온보딩 — 처음 사용자 가이드",
      "/투자금 [금액] [분할횟수] [목표수익률] [성향] [일손실한도%] — 매수 계획 설정",
      "/브리핑 — 오늘 장전 핵심 요약",
    ],
  },
  {
    title: "일일 점검",
    lines: [
      "/섹터 — 주도 섹터 랭킹",
      "/다음섹터 — 수급 유입 섹터",
      "/종목 <섹터> — 섹터별 대표 종목",
      "/스캔 [섹터] — 눌림목 스캐너",
      "/눌림목 — 눌림목 매집 후보",
    ],
  },
  {
    title: "종목 분석",
    lines: [
      "/매매 <이름|코드> — 점수·진입/손절/익절·수량",
      "/재무 <이름|코드> — 핵심 재무지표",
      "/수급 [종목] — 외국인·기관 매매동향",
      "/뉴스 [종목] — 시장·종목 뉴스",
    ],
  },
  {
    title: "포트폴리오",
    lines: [
      "/관심 — 관심종목 포트폴리오",
      "/관심추가 <종목> [매수가] — 종목 추가",
      "/관심삭제 <종목> [수량] — 전량/부분 매도",
      "/관심수정 <종목> <매수가> [수량] — 매수가·수량 수정",
      "/관심자동 — 기준 충족 시 자동 매도 기록",
      "/관심대응 — 익일 대응 플랜(무체결)",
      "/기록 [일수] — 가상 매매 기록",
    ],
  },
  {
    title: "시장·리포트·소셜",
    lines: [
      "/kospi /kosdaq — 보수형 추천 TOP5",
      "코스피 / 코스닥 텍스트만 보내도 동일하게 처리",
      "/etf — ETF 허브",
      "/etf 추천 — ETF 보수형 추천 TOP5",
      "/etfhub — ETF 허브 별칭",
      "/etfcore /etftheme — ETF 전략형 추천",
      "/etf 정보 종목명 — ETF NAV·괴리율",
      "/etf 분배금 종목명 — ETF 분배금·배당락",
      "/etfinfo 종목명 / /etfdiv 종목명 — 직접 명령도 지원",
      "/경제 — 글로벌 경제지표",
      "/시장 — 종합 시장 진단",
      "/리포트 — 가능한 리포트 종류 안내",
      "/리포트 주간|포트폴리오|거시|수급|섹터 — PDF 리포트",
      "/프로필 — 내 사용 통계",
      "/랭킹 — 포트폴리오 수익률 순위",
      "/팔로우 @닉네임 — 트레이더 팔로우",
      "/언팔로우 @닉네임 — 팔로우 해제",
      "/피드 — 팔로잉 포트폴리오",
    ],
  },
] as const;

const UNKNOWN_COMMAND_TOKENS = [
  "/온보딩",
  "/브리핑",
  "/리포트",
  "/섹터",
  "/다음섹터",
  "/종목",
  "/스캔",
  "/매매",
  "/재무",
  "/투자금",
  "/kospi",
  "/kosdaq",
  "/etf",
  "/etfhub",
  "/etfcore",
  "/etftheme",
  "/etfinfo",
  "/etfdiv",
  "/알림",
  "/눌림목",
  "/관심",
  "/관심추가",
  "/관심삭제",
  "/관심수정",
  "/관심자동",
  "/관심대응",
  "/수급",
  "/경제",
  "/뉴스",
  "/시장",
  "/기록",
  "/프로필",
  "/랭킹",
  "/팔로우",
  "/언팔로우",
  "/피드",
] as const;

const PROMPT_PRESET_LIST: PromptPreset[] = [
  {
    kind: "trade",
    title: "매매 분석",
    placeholder: "[trade] 종목명 또는 코드 입력",
    replyPrefix: "/매매",
    replyHints: ["매매", "점수", "매수"],
  },
  {
    kind: "finance",
    title: "재무 조회",
    placeholder: "[finance] 종목명 또는 코드 입력",
    replyPrefix: "/재무",
    replyHints: ["재무"],
  },
  {
    kind: "news",
    title: "뉴스 조회",
    placeholder: "[news] 종목명 또는 코드 입력",
    replyPrefix: "/뉴스",
    replyHints: ["뉴스"],
  },
  {
    kind: "flow",
    title: "수급 조회",
    placeholder: "[flow] 종목명 또는 코드 입력",
    replyPrefix: "/수급",
    replyHints: ["수급"],
  },
  {
    kind: "capital",
    title: "투자금 설정",
    placeholder: "[capital] 300만원 3 8 안전형 5",
    replyPrefix: "/투자금",
    replyHints: ["투자금"],
  },
  {
    kind: "etfinfo",
    title: "ETF NAV 조회",
    placeholder: "[etfinfo] ETF명 또는 코드 입력",
    replyPrefix: "/ETF 정보",
    replyHints: ["ETF NAV"],
  },
  {
    kind: "etfdiv",
    title: "ETF 분배금 조회",
    placeholder: "[etfdiv] ETF명 또는 코드 입력",
    replyPrefix: "/ETF 분배금",
    replyHints: ["ETF 분배금"],
  },
];

export const PROMPT_PRESETS: Record<PromptKind, PromptPreset> = PROMPT_PRESET_LIST.reduce(
  (acc, preset) => {
    acc[preset.kind] = preset;
    return acc;
  },
  {} as Record<PromptKind, PromptPreset>
);

export const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "시작 · 메뉴" },
  { command: "onboarding", description: "초보자 온보딩 가이드" },
  { command: "sector", description: "주도 섹터 랭킹" },
  { command: "scan", description: "눌림목 스캐너" },
  { command: "trade", description: "매매 통합 분석" },
  { command: "finance", description: "재무 요약" },
  { command: "capital", description: "투자금 설정" },
  { command: "brief", description: "장전 브리핑" },
  { command: "report", description: "리포트 도움말 · /리포트 주간" },
  { command: "alert", description: "이상징후 점검" },
  { command: "economy", description: "글로벌 경제지표" },
  { command: "news", description: "시장·종목 뉴스" },
  { command: "market", description: "종합 시장 진단" },
  { command: "watchlist", description: "관심종목 포트폴리오" },
  { command: "flow", description: "외국인·기관 수급" },
  { command: "nextsector", description: "수급 유입 섹터" },
  { command: "pullback", description: "눌림목 매집 후보" },
  { command: "ranking", description: "포트폴리오 랭킹" },
  { command: "profile", description: "내 프로필" },
  { command: "follow", description: "트레이더 팔로우" },
  { command: "feed", description: "팔로잉 피드" },
  { command: "help", description: "도움말" },
];

export function getPromptPreset(kind: string): PromptPreset | undefined {
  return PROMPT_PRESETS[kind as PromptKind];
}

export function getReplyPrefixForPromptKind(kind: string): string | undefined {
  return getPromptPreset(kind)?.replyPrefix;
}

export function resolveReplyPrefixFromText(replyText: string): string | undefined {
  const text = replyText.trim();
  if (!text) return undefined;

  return PROMPT_PRESET_LIST.find((preset) =>
    preset.replyHints.some((hint) => text.includes(hint))
  )?.replyPrefix;
}

export function resolveCallbackCommandText(command: string): string | undefined {
  if (command.startsWith("report:")) return `/report ${command.slice(7)}`;
  if (command === "etf:core") return "/etfcore";
  if (command === "etf:theme") return "/etftheme";
  if (command.startsWith("etf:")) return `/etf ${command.slice(4)}`;
  return CALLBACK_COMMAND_TEXT[command];
}

export function resolveCallbackPrefixedCommandText(
  prefix: string,
  payload: string
): string | undefined {
  const base = CALLBACK_PREFIX_TEXT[prefix];
  if (!base || !payload.trim()) return undefined;
  return `${base} ${payload.trim()}`;
}

export function buildHelpMessage(): string {
  const lines = ["도움말 (/help, /도움말)", "─────────────────"];

  for (const section of HELP_SECTIONS) {
    lines.push(section.title);
    lines.push(...section.lines);
    lines.push("");
  }

  lines.push("참고: 버튼과 텍스트 명령은 같은 동작으로 연결됩니다.");
  return lines.join("\n").trim();
}

export function buildUnknownCommandMessage(): string {
  const perLine = 11;
  const chunks: string[] = [];

  for (let index = 0; index < UNKNOWN_COMMAND_TOKENS.length; index += perLine) {
    chunks.push(UNKNOWN_COMMAND_TOKENS.slice(index, index + perLine).join(" "));
  }

  return ["알 수 없는 명령입니다.", ...chunks].join("\n");
}