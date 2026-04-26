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
  weeklycopilot: "/주간코파일럿",
  brief: "/brief",
  premarket: "/장전플랜",
  market: "/market",
  economy: "/economy",
  sector: "/sector",
  nextsector: "/nextsector",
  pullback: "/pullback",
  onboarding: "/onboarding",
  watchonly: "/관심",
  watchlist: "/보유",
  watchonlyresp: "/관심대응",
  watchresp: "/보유대응",
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
  riskprofile: "/투자성향",
  strategy: "/전략선택",
};

const CALLBACK_PREFIX_TEXT: Record<string, string> = {
  trade: "/종목분석",
  finance: "/finance",
  news: "/news",
  etfinfo: "/etfinfo",
  etfdiv: "/etfdiv",
  watchadd: "/관심추가",
};

const HELP_SECTIONS = [
  {
    title: "빠른 시작",
    lines: [
      "/주간코파일럿 — 주간 핵심 실행(브리핑→장전플랜→보유대응)",
      "/주간코파일럿 강제 — 동일일 재실행(필요 시)",
      "/온보딩 — 처음 사용자 가이드",
      "/투자성향 [안전형|균형형|공격형] — 기본 투자성향 설정",
      "/투자금 [금액] [분할횟수] [목표수익률] [성향] [일손실한도%] — 매수 계획 설정",
      "/전략선택 — 자동매매 기본 전략 선택",
      "/브리핑 — 오늘 장전 핵심 요약",
      "/장전플랜 — 9시 전 예약 주문용 종목·수량·매도가",
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
      "/종목분석 <이름|코드> — 점수·진입/손절·목표가·수량 분석",
      "/재무 <이름|코드> — 핵심 재무지표",
      "/수급 [종목] — 외국인·기관 매매동향",
      "/뉴스 [종목] — 시장·종목 뉴스",
    ],
  },
  {
    title: "포트폴리오",
    lines: [
      "/관심 — 관심 종목 추적 목록",
      "/관심추가 <종목> — 관심 목록에 추가",
      "/관심제거 <종목> — 관심 목록에서 제거",
      "/관심초기화 확인 — 관심 목록 일괄 삭제",
      "/관심대응 — 관심 종목 대응 플랜(미체결)",
      "/보유 — 가상 보유 포트폴리오",
      "/가상매수 <종목> [매수가] — 새 포지션 편입",
      "/가상매도 <종목> [수량] — 전량/부분 매도",
      "/전체매도 확인 — 보유 포지션 일괄 전량 매도",
      "/보유수정 <종목> <매수가> [수량] — 보유 단가·수량 수정",
      "/보유복구 <종목> <매수가> <수량> — 누락된 보유 포지션 복구",
      "/자동매도점검 — 기준 충족 시 자동 매도 기록",
      "/자동사이클 점검 — 오늘 기준 시뮬레이션",
      "/자동사이클 실행 — 오늘 기준 실제 반영",
      "/자동사이클 실행 진입 — 요일 무관 신규 진입 판단 강제",
      "/자동트리거 [장중|게이트|점수|브리핑|리포트|야간] — 운영 채팅 수동 트리거",
      "/장전플랜 — 직장인용 장전 주문 카드",
      "  현재는 보유 종목 추가매수, 부분 익절, 분할 매도, 포지션별 전략 상태를 함께 반영",
      "/보유대응 — 익일 대응 플랜(무체결)",
      "/거래기록 [이번달|지난달|4월|4월 1주|7|최근 7일|전체] — 가상 매매 기록",
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
      "/리포트 눌림목 — 다음 주 선진입 후보 PDF",
      "/리포트 월간 — 월별 성과 요약 텍스트",
      "/리포트 실전운용 — 월~금 자동매매 체크리스트 텍스트",
      "/리포트 추천 — 오늘 대응할 투자 후보 텍스트 리포트",
      "  자동사이클의 전략, 추가매수, 부분 익절/분할 매도 점검에 사용",
      "/리포트 가이드 — 기능 활용 운영 가이드 PDF",
      "/리포트 주간|눌림목|포트폴리오|거시|수급|섹터 — PDF 리포트",
      "/가이드pdf — 운영 가이드 PDF 바로 받기",
      "/프로필 — 내 사용 통계",
      "/랭킹 — 포트폴리오 수익률 순위",
      "/팔로우 @닉네임 — 트레이더 팔로우",
      "/언팔로우 @닉네임 — 팔로우 해제",
      "/피드 — 팔로잉 포트폴리오",
    ],
  },
] as const;

const CORE_HELP_LINES = [
  "핵심 5단계 여정",
  "1) /brief — 오늘 브리핑",
  "2) /scan · /pullback — 후보 스캔",
  "3) /종목분석 · /재무 · /수급 — 종목 검증",
  "4) /장전플랜 · /보유 · /자동사이클 실행 — 매매/포트폴리오",
  "5) /리포트 추천 · /주간코파일럿 — 주간 복기",
] as const;

const UNKNOWN_COMMAND_TOKENS = [
  "/주간코파일럿",
  "/온보딩",
  "/브리핑",
  "/리포트",
  "/가이드pdf",
  "/섹터",
  "/다음섹터",
  "/종목",
  "/스캔",
  "/종목분석",
  "/재무",
  "/투자금",
  "/투자성향",
  "/전략선택",
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
  "/관심제거",
  "/관심초기화",
  "/관심대응",
  "/보유",
  "/가상매수",
  "/가상매도",
  "/전체매도",
  "/보유수정",
  "/보유복구",
  "/자동매도점검",
  "/자동사이클",
  "/자동트리거",
  "/장전플랜",
  "/보유대응",
  "/수급",
  "/경제",
  "/뉴스",
  "/시장",
  "/거래기록",
  "/프로필",
  "/랭킹",
  "/팔로우",
  "/언팔로우",
  "/피드",
] as const;

const PROMPT_PRESET_LIST: PromptPreset[] = [
  {
    kind: "trade",
    title: "종목 분석",
    placeholder: "[trade] 종목명 또는 코드 입력",
    replyPrefix: "/종목분석",
    replyHints: ["종목 분석"],
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
  { command: "weekly", description: "주간 코파일럿(브리핑·플랜·보유대응)" },
  { command: "onboarding", description: "초보자 온보딩 가이드" },
  { command: "sector", description: "주도 섹터 랭킹" },
  { command: "scan", description: "눌림목 스캐너" },
  { command: "analyze", description: "종목 분석" },
  { command: "finance", description: "재무 요약" },
  { command: "capital", description: "투자금 설정" },
  { command: "brief", description: "장전 브리핑" },
  { command: "report", description: "리포트 도움말 · /리포트 추천·주간·월간" },
  { command: "guidepdf", description: "운영 가이드 PDF" },
  { command: "alert", description: "이상징후 점검" },
  { command: "economy", description: "글로벌 경제지표" },
  { command: "news", description: "시장·종목 뉴스" },
  { command: "market", description: "종합 시장 진단" },
  { command: "watchlist", description: "관심 종목 추적" },
  { command: "watchadd", description: "관심 종목 추가" },
  { command: "watchremove", description: "관심 종목 제거" },
  { command: "watchreset", description: "관심 목록 초기화" },
  { command: "watchplan", description: "관심 종목 대응 플랜" },
  { command: "holdings", description: "가상 보유 포트폴리오" },
  { command: "paperbuy", description: "가상 매수" },
  { command: "papersell", description: "가상 매도" },
  { command: "liquidateall", description: "보유 포지션 전체매도" },
  { command: "holdingedit", description: "보유 단가·수량 수정" },
  { command: "holdingrestore", description: "누락 보유 포지션 복구" },
  { command: "autosellcheck", description: "자동 매도 점검" },
  { command: "autocycle", description: "자동사이클 점검·실행·진입" },
  { command: "opsrun", description: "운영 수동 트리거(준비/장중/마감/전체)" },
  { command: "premarket", description: "장전 주문 플랜" },
  { command: "holdingplan", description: "보유 대응 플랜" },
  { command: "tradelog", description: "거래 기록" },
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
  if (command === "opstrigger:ready") return "/자동트리거 준비";
  if (command === "opstrigger:intraday") return "/자동트리거 장중";
  if (command === "opstrigger:close") return "/자동트리거 마감";
  if (command === "opstrigger:all") return "/자동트리거 전체";
  if (command === "opstrigger:gate") return "/자동트리거 게이트";
  if (command === "opstrigger:score") return "/자동트리거 점수";
  if (command === "opstrigger:briefing") return "/자동트리거 브리핑";
  if (command === "opstrigger:report") return "/자동트리거 리포트";
  if (command === "opstrigger:night") return "/자동트리거 야간";
  if (command === "weeklycopilot:force") return "/주간코파일럿 강제";
  if (command === "autocycle:check") return "/자동사이클 점검";
  if (command === "autocycle:run") return "/자동사이클 실행";
  if (command === "autocycle:entry-check") return "/자동사이클 점검 진입";
  if (command === "autocycle:entry-run") return "/자동사이클 실행 진입";
  if (command === "premarket") return "/장전플랜";
  if (command.startsWith("tradelog:")) {
    const scope = command.slice(9);
    if (scope === "month") return "/거래기록";
    if (scope === "last-month") return "/거래기록 지난달";
    if (scope === "recent-7") return "/거래기록 최근 7일";
    if (scope === "all") return "/거래기록 전체";
  }
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
  const lines = ["도움말 (/help, /도움말)", "─────────────────", ...CORE_HELP_LINES, ""];

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