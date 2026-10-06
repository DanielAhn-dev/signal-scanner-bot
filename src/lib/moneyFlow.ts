/**
 * 돈 흐름 점검 — 지출을 "줄일 수 있나" 기준으로 나눠 실제 투자 가능액을 보여 준다. DB·API 없이 계산만 한다.
 * 웹(빠른 기록 화면)과 서버(입력 검증)가 같은 분류표를 쓰도록 이 파일 하나에 둔다.
 *
 * 원칙 (2026-10-06 사용자와 합의):
 *   - 일반 가계부가 아니다. 목적은 "현금 지출 중 줄일 수 있는 것과 없는 것"을 알고 투자 가능액을 정하는 것.
 *   - 소분류는 "어떻게 먹었나(쓰임새)"가 아니라 "무슨 물건인가"로 나눈다. 냉동피자는 식사든 간식이든 간편식·냉동.
 *   - 줄일 수 있나(must/trim/drop)는 사용자가 정한다. 기본값만 제안하고 화면은 줄이라고 판단하지 않는다.
 *   - 포인트로 낸 소비도 생활 소비에 넣는다. 다만 현금 지출과 따로 보여 주고, "이번만" 포인트는 다음 달 현금이 된다고 본다.
 *   - 환급·캐시백(모두의카드 교통 환급, 카드 캐시백 등)은 돌려받은 만큼 현금 지출에서 뺀다 — 그만큼 투자할 수 있는 돈이 생긴다.
 *     소비 자체는 줄지 않으므로 생활 소비·비상자금 기준에는 그대로 두고, 포인트처럼 "매달"과 "이번만"을 나눈다.
 *   - 자동 분류는 무료·즉시·재현 가능해야 한다: 사용자가 고친 기록 > 기본 단어 사전 > 자주 쓰는 소분류 제안. AI 호출 없음.
 */

export type FlowKind = "fixed" | "variable" | "irregular";
/** must = 못 줄임, trim = 줄일 수 있음(금액 조절), drop = 끊을 수 있음 */
export type CutLevel = "must" | "trim" | "drop";
/**
 * point_regular = 매달 꾸준히 들어오는 포인트, point_once = 이번만(이벤트·선물·소멸 직전).
 * refund_regular / refund_once = 계좌로 돌려받은 돈(환급·캐시백). 금액은 양수로 적고, 그 지출의 소분류에 붙인다.
 */
export type Payment = "cash" | "point_regular" | "point_once" | "refund_regular" | "refund_once";
export const isRefund = (payment: Payment | undefined) => payment === "refund_regular" || payment === "refund_once";
/** 통장 기준 효과: 현금 지출은 +, 환급은 −, 포인트는 0 */
export const cashEffect = (item: { amount: number; payment?: Payment }) => {
  const payment = item.payment ?? "cash";
  const amount = Math.max(0, item.amount);
  return payment === "cash" ? amount : isRefund(payment) ? -amount : 0;
};
/** 시드 만들기(seed_builder_months.expenses)의 큰 항목. 소분류를 여기로 묶어 넘긴다. */
export type SeedExpenseKey = "food" | "housing" | "vehicle" | "education" | "tax" | "subscriptions" | "other";

export type FlowCategory = {
  id: string;
  label: string;
  kind: FlowKind;
  major: string;
  cut: CutLevel;
  seed: SeedExpenseKey;
};

const c = (kind: FlowKind, major: string, seed: SeedExpenseKey, rows: Array<[string, string, CutLevel]>): FlowCategory[] =>
  rows.map(([id, label, cut]) => ({ id, label, kind, major, cut, seed }));

export const FLOW_CATEGORIES: FlowCategory[] = [
  ...c("fixed", "주거", "housing", [["rent", "월세·대출이자", "must"], ["maintenance", "관리비", "must"], ["utilities", "전기·가스·수도", "trim"]]),
  ...c("fixed", "통신", "subscriptions", [["phone", "휴대폰", "trim"], ["internet", "인터넷·TV", "trim"]]),
  ...c("fixed", "구독", "subscriptions", [["sub_media", "영상·음악", "drop"], ["sub_membership", "쇼핑 멤버십", "drop"], ["sub_app", "클라우드·앱", "drop"]]),
  ...c("fixed", "보험", "tax", [["ins_health", "실손·건강", "must"], ["ins_other", "생명·기타", "trim"]]),
  ...c("fixed", "교육", "education", [["academy", "학원", "trim"], ["course", "강의·교재", "trim"]]),
  ...c("fixed", "가족", "other", [["family_parents", "부모님 용돈", "must"], ["family_kids", "자녀 용돈", "trim"]]),
  ...c("fixed", "회비·기부", "other", [["dues", "회비·기부", "trim"]]),
  ...c("variable", "식재료", "food", [["grocery_mart", "장보기(마트)", "trim"], ["grocery_basic", "기본 식재료", "must"], ["grocery_ready", "간편식·냉동", "trim"], ["grocery_snack", "과자·음료", "drop"], ["grocery_drink", "생수·커피", "trim"]]),
  ...c("variable", "사 먹기", "food", [["eat_out", "외식", "trim"], ["delivery", "배달", "drop"], ["cafe", "카페", "drop"], ["snack_out", "간식", "drop"], ["convenience", "편의점", "drop"]]),
  ...c("variable", "생활용품", "other", [["hygiene", "세제·위생", "must"], ["kitchen", "주방·소모품", "trim"], ["gadget", "소형 가전·도구", "trim"]]),
  ...c("variable", "교통", "vehicle", [["transit", "대중교통", "must"], ["fuel", "주유", "trim"], ["taxi", "택시", "drop"], ["parking", "주차·통행료", "trim"]]),
  ...c("variable", "의료", "other", [["medical", "병원·약", "must"], ["supplement", "영양제", "trim"]]),
  ...c("variable", "꾸밈", "other", [["clothes", "옷·신발", "trim"], ["beauty", "미용", "trim"], ["cosmetics", "화장품", "trim"]]),
  ...c("variable", "여가", "other", [["hobby", "취미·운동", "trim"], ["culture", "문화·공연", "drop"], ["game", "게임·앱 결제", "drop"]]),
  ...c("variable", "기타", "other", [["etc", "기타 생활", "trim"]]),
  ...c("irregular", "세금", "tax", [["tax", "세금", "must"]]),
  ...c("irregular", "차량", "vehicle", [["car", "자동차보험·정비", "must"]]),
  ...c("irregular", "경조사·명절", "other", [["occasion", "경조사·명절", "trim"]]),
  ...c("irregular", "여행", "other", [["travel", "여행", "drop"]]),
  ...c("irregular", "큰 물건", "other", [["big_item", "가전·가구", "trim"]]),
];

const CATEGORY_BY_ID = new Map(FLOW_CATEGORIES.map((category) => [category.id, category]));
export const FALLBACK_CATEGORY_ID = "etc";

export function categoryById(id: string): FlowCategory | undefined {
  return CATEGORY_BY_ID.get(id);
}

/**
 * 기본 단어 사전. 메모에 들어 있으면 그 소분류로 본다. 여러 개가 걸리면 긴 단어가 이긴다
 * ("스타벅스 커피"는 커피(생수·커피)가 아니라 스타벅스(카페), "자동차보험"은 보험이 아니라 차량).
 * 쓰임새가 갈리는 단어(피자·치킨·점심 도시락 등)는 일부러 넣지 않는다 — 모르면 사용자가 한 번 고르고 그걸 기억한다.
 */
const DICTIONARY: Record<string, string[]> = {
  rent: ["월세", "대출이자", "주담대"],
  maintenance: ["관리비"],
  utilities: ["전기요금", "가스요금", "수도요금", "도시가스", "전기세", "수도세"],
  phone: ["휴대폰", "핸드폰", "통신비", "skt", "lgu+", "알뜰폰"],
  internet: ["인터넷", "iptv"],
  sub_media: ["넷플릭스", "유튜브프리미엄", "유튜브 프리미엄", "디즈니", "티빙", "웨이브", "쿠팡플레이", "멜론", "지니뮤직", "스포티파이"],
  sub_membership: ["와우", "로켓와우", "네이버플러스", "멤버십"],
  sub_app: ["icloud", "아이클라우드", "구글원", "google one", "chatgpt", "claude"],
  ins_health: ["실손", "건강보험"],
  ins_other: ["보험료", "생명보험", "종신보험"],
  academy: ["학원", "과외"],
  course: ["강의", "교재", "인강", "도서"],
  family_parents: ["부모님"],
  family_kids: ["아이 용돈", "자녀 용돈"],
  dues: ["회비", "기부", "후원"],
  grocery_basic: ["우유", "쌀", "계란", "달걀", "두부", "채소", "야채", "과일", "사과", "바나나", "고기", "돼지고기", "소고기", "닭가슴살", "김치", "식빵"],
  // 마트는 뭐든 섞여 있어 품목을 따지지 않고 장보기 금액 전체를 줄일지 본다.
  grocery_mart: ["이마트", "홈플러스", "롯데마트", "농협", "하나로마트", "코스트코", "트레이더스", "마트", "장보기"],
  grocery_ready: ["냉동", "만두", "라면", "밀키트", "즉석", "햇반", "볶음밥", "냉동피자"],
  grocery_snack: ["과자", "콘칩", "콘칲", "새우깡", "감자칩", "초콜릿", "아이스크림", "젤리", "음료", "콜라", "사이다", "탄산"],
  grocery_drink: ["생수", "삼다수", "원두", "캡슐", "커피믹스", "커피"],
  eat_out: ["외식", "식당", "회식", "뚝배기", "국밥", "백반", "맥도날드", "맥모닝", "버거킹", "롯데리아", "맘스터치", "김밥천국", "햄버거"],
  delivery: ["배민", "배달의민족", "쿠팡이츠", "요기요", "배달"],
  cafe: ["스타벅스", "이디야", "메가커피", "컴포즈", "투썸", "빽다방", "카페", "폴바셋", "라떼", "아메리카노"],
  snack_out: ["무인아이스크림", "아이스크림(무인)", "아이스크림 할인점", "아이스크림할인"],
  convenience: ["gs25", "cu", "세븐일레븐", "이마트24", "편의점"],
  hygiene: ["세제", "휴지", "화장지", "샴푸", "치약", "칫솔", "물티슈", "기저귀", "섬유유연제"],
  kitchen: ["수세미", "지퍼백", "키친타올", "주방"],
  gadget: ["체중계", "충전기", "케이블", "전구", "건전지", "멀티탭"],
  transit: ["버스", "지하철", "교통카드", "교통요금", "교통비", "티머니", "ktx", "srt", "모두의카드", "k패스", "k-패스", "케이패스", "기후동행"],
  fuel: ["주유", "주유소", "기름값"],
  taxi: ["택시", "카카오t"],
  parking: ["주차", "하이패스", "통행료"],
  medical: ["병원", "약국", "치과", "의원", "한의원"],
  supplement: ["영양제", "비타민", "오메가3", "유산균"],
  clothes: ["옷", "신발", "유니클로", "무신사", "자라"],
  beauty: ["미용실", "헤어", "네일", "이발"],
  cosmetics: ["화장품", "올리브영", "선크림"],
  hobby: ["헬스", "필라테스", "요가", "골프", "수영"],
  culture: ["영화", "공연", "전시", "콘서트", "cgv", "메가박스"],
  game: ["게임", "스팀", "인앱", "앱결제"],
  tax: ["재산세", "자동차세", "주민세", "연말정산", "종합소득세"],
  car: ["자동차보험", "정비", "타이어", "엔진오일", "자동차검사"],
  occasion: ["축의금", "조의금", "부의금", "경조사", "명절", "세뱃돈", "선물"],
  travel: ["여행", "항공권", "호텔", "숙소", "에어비앤비"],
  big_item: ["냉장고", "세탁기", "건조기", "소파", "침대", "가구", "에어컨"],
};

export type LearnedRule = { keyword: string; categoryId: string };

const isAscii = (text: string) => /^[\x00-\x7f]+$/.test(text);

/** 비교용 정규화: 소문자, 공백 하나로. */
export function normalizeMemo(memo: string): string {
  return memo.toLowerCase().replace(/\s+/g, " ").trim();
}

function contains(memo: string, keyword: string): boolean {
  const key = normalizeMemo(keyword);
  if (!key) return false;
  // 영문 약어("cu", "skt")는 다른 단어 속에 숨어 걸리지 않도록 앞뒤가 영문·숫자가 아닐 때만 인정한다.
  if (isAscii(key)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(memo);
  }
  return memo.includes(key) || memo.replace(/ /g, "").includes(key.replace(/ /g, ""));
}

/**
 * 고친 기록에 저장할 열쇠말: 수량·용량·금액 토큰을 뺀 메모. "냉동피자 4판" → "냉동피자".
 * 같은 메모를 다시 쓰면 그대로 걸리고, 짧은 메모("피자")는 긴 메모 안에서도 걸린다.
 */
export function learnKeyword(memo: string): string {
  return normalizeMemo(memo)
    .split(" ")
    .filter((token) => token && !/^[x×]?\d[\d.,]*[a-z가-힣]*$/i.test(token))
    .join(" ")
    .slice(0, 40)
    .trim();
}

export type Classification = { categoryId: string; source: "learned" | "dictionary" | "none"; matched?: string };

/** 사용자가 고친 기록 > 기본 사전. 각각 가장 긴 열쇠말이 이긴다. 못 찾으면 source "none"(화면이 버튼을 띄운다). */
export function classifyMemo(memo: string, learned: LearnedRule[] = []): Classification {
  const text = normalizeMemo(memo);
  if (!text) return { categoryId: FALLBACK_CATEGORY_ID, source: "none" };
  const best = (pairs: Array<[string, string]>) => {
    let hit: [string, string] | null = null;
    for (const [keyword, categoryId] of pairs) {
      if (!CATEGORY_BY_ID.has(categoryId) || !contains(text, keyword)) continue;
      if (!hit || normalizeMemo(keyword).length > normalizeMemo(hit[0]).length) hit = [keyword, categoryId];
    }
    return hit;
  };
  const learnedHit = best(learned.map((rule) => [rule.keyword, rule.categoryId]));
  if (learnedHit) return { categoryId: learnedHit[1], source: "learned", matched: learnedHit[0] };
  const dictHit = best(Object.entries(DICTIONARY).flatMap(([categoryId, words]) => words.map((word): [string, string] => [word, categoryId])));
  if (dictHit) return { categoryId: dictHit[1], source: "dictionary", matched: dictHit[0] };
  return { categoryId: FALLBACK_CATEGORY_ID, source: "none" };
}

/**
 * 뭐든 살 수 있는 '통로'(간편결제·종합 쇼핑몰). 이름만 있으면 무엇을 샀는지 몰라 분류가 안 되므로 산 물건을 묻는다.
 * "쿠팡이츠"·"네이버플러스"처럼 통로 이름 뒤에 글자가 더 붙으면 다른 가게로 보고 묻지 않는다.
 */
const PASS_THROUGH = ["네이버페이", "naverpay", "npay", "네이버쇼핑", "스마트스토어", "카카오페이", "kakaopay", "토스페이", "tosspay", "페이코", "payco", "스마일페이", "쿠페이", "쿠팡", "11번가", "g마켓", "지마켓", "옥션", "ssg", "ssg.com", "위메프", "티몬", "알리익스프레스", "알리", "테무", "temu", "아마존", "amazon"];
const PASS_THROUGH_NOISE = ["결제", "주문", "구매", "간편결제", "(주)", "주식회사"];

/**
 * 메모에 "배우자"가 있으면(앞이든 중간이든) 배우자 몫으로 보고, 그 단어를 뺀 메모를 돌려준다.
 * 한 사람이 둘의 지출·환급을 같이 적을 때 쓴다. "모두의 카드 배우자 환급" → { memo: "모두의 카드 환급", forPartner: true }
 */
export function splitPartnerWord(memo: string): { memo: string; forPartner: boolean } {
  if (!memo.includes("배우자")) return { memo, forPartner: false };
  return { memo: memo.replace(/배우자(의|꺼|거|것|용)?/g, " ").replace(/\s+/g, " ").trim(), forPartner: true };
}

/** 메모가 통로 이름뿐이라 "뭘 샀나요?"를 물어야 하는지. "네이버페이 32000" → true, "쿠팡 물티슈"·"쿠팡이츠" → false */
export function needsItemName(memo: string): boolean {
  let text = normalizeMemo(memo);
  if (!text) return false;
  const words = [...PASS_THROUGH].sort((a, b) => b.length - a.length);
  if (!words.some((word) => contains(text, word))) return false;
  for (const word of [...words, ...PASS_THROUGH_NOISE]) text = text.split(normalizeMemo(word)).join(" ");
  return text.replace(/[\s()[\]{}.,·:/_-]+/g, "").length === 0;
}

/** 이 금액 미만인데 분류를 못 한 줄은 묻지 않고 '기타 생활'로 둔다. 작은 금액은 틀려도 점검 결론이 바뀌지 않는다 */
export const SMALL_UNKNOWN_LIMIT = 10_000;

/** 메모에 환급·캐시백이 있으면 돌려받은 돈으로 본다. 교통 환급 카드처럼 매달 들어오는 것은 "매달" */
const REFUND_WORDS = ["환급", "캐시백", "페이백", "돌려받"];
const REGULAR_REFUND_WORDS = ["모두의카드", "k패스", "케이패스", "기후동행"];
export function detectPayment(memo: string): Payment {
  const text = normalizeMemo(memo).replace(/[ -]/g, "");
  if (!REFUND_WORDS.some((w) => text.includes(w))) return "cash";
  return REGULAR_REFUND_WORDS.some((w) => text.includes(w)) ? "refund_regular" : "refund_once";
}

/** 분류를 못 했을 때 보여 줄 버튼: 최근 기록에서 자주 쓴 소분류 순, 모자라면 흔한 소분류로 채운다. */
export function suggestCategories(recentCategoryIds: string[], count = 3): string[] {
  const freq = new Map<string, number>();
  for (const id of recentCategoryIds) if (CATEGORY_BY_ID.has(id)) freq.set(id, (freq.get(id) ?? 0) + 1);
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of ["grocery_basic", "eat_out", "etc", "hygiene"]) if (!ranked.includes(id)) ranked.push(id);
  return ranked.slice(0, count);
}

const MAX_AMOUNT = 100_000_000_000;

/** 금액 토큰 하나를 원 단위 정수로. "15170", "15,170원", "₩15,170", "3만", "1.5만원", "5천원", "1만5천" */
export function parseAmountToken(token: string): number | null {
  const t = token.replace(/^₩/, "").replace(/원$/, "");
  let value: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+(?:\.\d+)?)만(?:(\d+)천)?$/))) value = Number(m[1]) * 10_000 + (m[2] ? Number(m[2]) * 1_000 : 0);
  else if ((m = t.match(/^(\d+)천$/))) value = Number(m[1]) * 1_000;
  else if (/^\d{1,3}(,\d{3})+$/.test(t) || /^\d+$/.test(t)) value = Number(t.replace(/,/g, ""));
  if (value === null || !Number.isFinite(value)) return null;
  value = Math.round(value);
  return value > 0 && value <= MAX_AMOUNT ? value : null;
}

/** amountGuessed: "원" 같은 표시 없이 맨숫자가 여러 개라 금액을 추정했다 → 화면이 "금액 확인"을 띄운다 */
export type ParsedQuick = { amount: number; memo: string; date?: string; amountGuessed: boolean };

const pad2 = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null;
};

/**
 * 줄 맨 앞의 날짜 토큰. 261001 · 20261001 · 2026-10-01 · 26.10.01 · 10/1 · 10.1
 * 오늘 이후가 되는 값은 날짜로 보지 않는다(월/일만 쓴 경우는 작년으로 본다: 1월에 12/30 입력).
 */
export function parseLeadingDate(token: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  let m: RegExpMatchArray | null;
  let date: string | null = null;
  if ((m = token.match(/^(\d{2})(\d{2})(\d{2})$/))) date = validYmd(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = token.match(/^(20\d{2})(\d{2})(\d{2})$/))) date = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = token.match(/^(20\d{2}|\d{2})[-./](\d{1,2})[-./](\d{1,2})\.?$/))) date = validYmd(Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = token.match(/^(\d{1,2})[/.](\d{1,2})\.?$/))) {
    date = validYmd(year, Number(m[1]), Number(m[2]));
    if (date && date > today) date = validYmd(year - 1, Number(m[1]), Number(m[2]));
    return date;
  }
  return date && date <= today ? date : null;
}

/**
 * 한 줄 입력 → (날짜) + 금액 + 메모. 상품명을 그대로 붙여 넣어도 되게 한다.
 *  - 맨 앞 토큰이 날짜 형식이면 그 줄의 날짜.
 *  - 금액은 "원·만·천·₩·쉼표"가 붙은 토큰 중 맨 뒤. 없으면 맨숫자 중 가장 큰 값(여러 개면 추정 표시).
 *  - "4판", "900ml,", "2개", "X15", "70g,"처럼 글자가 붙은 숫자는 금액이 아니다.
 */
export function parseQuickLine(line: string, today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })): ParsedQuick | null {
  let tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let date: string | undefined;
  if (tokens.length > 1) {
    const leading = parseLeadingDate(tokens[0], today);
    if (leading) { date = leading; tokens = tokens.slice(1); }
  }
  const marked = (token: string) => /^₩|원$|만|천|,/.test(token);
  let index = -1;
  let amountGuessed = false;
  for (let i = tokens.length - 1; i >= 0; i--) if (marked(tokens[i]) && parseAmountToken(tokens[i]) !== null) { index = i; break; }
  if (index < 0) {
    const bare = tokens.map((t, i) => [t, i] as const).filter(([t]) => /^\d+$/.test(t) && parseAmountToken(t) !== null);
    if (bare.length === 0) return null;
    index = bare.reduce((best, cur) => (Number(cur[0]) >= Number(best[0]) ? cur : best))[1];
    amountGuessed = bare.length > 1;
  }
  const amount = parseAmountToken(tokens[index])!;
  const memo = tokens.filter((_, i) => i !== index).join(" ").replace(/[,\s]+$/, "").slice(0, 100);
  return { amount, memo, date, amountGuessed };
}

/** 여러 줄 붙여넣기. 금액을 못 읽은 줄은 버리지 않고 failed로 돌려줘 화면에서 고치게 한다. */
export function parseQuickLines(text: string, today?: string): { parsed: ParsedQuick[]; failed: string[] } {
  const parsed: ParsedQuick[] = [];
  const failed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const result = parseQuickLine(line, today);
    if (result) parsed.push(result);
    else failed.push(line);
  }
  return { parsed, failed };
}

/** 지출 한 건. cut이 없으면 소분류 기본값. mustPart는 "이 중 못 줄이는 몫"(cut이 must가 아닐 때만 의미). */
export type FlowItem = {
  categoryId: string;
  amount: number;
  payment?: Payment;
  cut?: CutLevel;
  mustPart?: number;
  label?: string;
  /** 자녀 계좌(childGifts)의 자녀 id. 없으면 가족 공통 */
  childId?: string;
};

export type CutSplit = { must: number; trim: number; drop: number };

/** 한 건을 못 줄임/줄일 수 있음/끊을 수 있음 금액으로 나눈다. */
export function splitByCut(item: FlowItem): CutSplit {
  const level = item.cut ?? categoryById(item.categoryId)?.cut ?? "trim";
  const amount = Math.max(0, item.amount);
  const must = level === "must" ? amount : Math.min(amount, Math.max(0, item.mustPart ?? 0));
  const rest = amount - must;
  return { must, trim: level === "trim" ? rest : 0, drop: level === "drop" ? rest : 0 };
}

export type FlowSummary = {
  /** 현금·카드·포인트 전부 */
  consumption: number;
  /** 포인트를 뺀, 통장에서 실제로 나간 돈 */
  cash: number;
  pointRegular: number;
  pointOnce: number;
  /** 돌려받은 돈(환급·캐시백). cash에서 이미 뺐다 */
  refundRegular: number;
  refundOnce: number;
  /** 현금 기준 줄일 수 있나 */
  cashByCut: CutSplit;
  /** 소비(포인트 포함) 기준 줄일 수 있나 — 비상자금 기준은 여기 must를 쓴다(포인트가 끊겨도 필요한 돈) */
  consumptionByCut: CutSplit;
  byKind: Record<FlowKind, number>;
  byMajor: Array<{ major: string; kind: FlowKind; amount: number }>;
  byCategory: Array<{ categoryId: string; amount: number; cash: number }>;
};

const emptySplit = (): CutSplit => ({ must: 0, trim: 0, drop: 0 });
const addSplit = (target: CutSplit, source: CutSplit) => { target.must += source.must; target.trim += source.trim; target.drop += source.drop; };

export function summarizeItems(items: FlowItem[]): FlowSummary {
  const summary: FlowSummary = {
    consumption: 0, cash: 0, pointRegular: 0, pointOnce: 0, refundRegular: 0, refundOnce: 0,
    cashByCut: emptySplit(), consumptionByCut: emptySplit(),
    byKind: { fixed: 0, variable: 0, irregular: 0 }, byMajor: [], byCategory: [],
  };
  const majors = new Map<string, { major: string; kind: FlowKind; amount: number }>();
  const cats = new Map<string, { categoryId: string; amount: number; cash: number }>();
  for (const item of items) {
    const category = categoryById(item.categoryId) ?? categoryById(FALLBACK_CATEGORY_ID)!;
    const amount = Math.max(0, item.amount);
    const payment = item.payment ?? "cash";
    const split = splitByCut(item);
    if (isRefund(payment)) {
      // 소비는 그대로, 통장에서 나간 돈만 줄인다(같은 소분류·같은 줄일 수 있나 칸에서)
      summary.cash -= amount;
      if (payment === "refund_regular") summary.refundRegular += amount; else summary.refundOnce += amount;
      summary.cashByCut.must -= split.must; summary.cashByCut.trim -= split.trim; summary.cashByCut.drop -= split.drop;
      const cat = cats.get(category.id) ?? { categoryId: category.id, amount: 0, cash: 0 };
      cat.cash -= amount;
      cats.set(category.id, cat);
      continue;
    }
    summary.consumption += amount;
    addSplit(summary.consumptionByCut, split);
    if (payment === "cash") { summary.cash += amount; addSplit(summary.cashByCut, split); }
    else if (payment === "point_regular") summary.pointRegular += amount;
    else summary.pointOnce += amount;
    summary.byKind[category.kind] += amount;
    const majorKey = `${category.kind}:${category.major}`;
    const major = majors.get(majorKey) ?? { major: category.major, kind: category.kind, amount: 0 };
    major.amount += amount;
    majors.set(majorKey, major);
    const cat = cats.get(category.id) ?? { categoryId: category.id, amount: 0, cash: 0 };
    cat.amount += amount;
    if (payment === "cash") cat.cash += amount;
    cats.set(category.id, cat);
  }
  // 환급이 그 칸 지출보다 크게 적힌 경우(다른 달에 쓴 돈의 환급 등) 칸이 음수가 되지 않게 한다
  for (const level of ["must", "trim", "drop"] as const) summary.cashByCut[level] = Math.max(0, summary.cashByCut[level]);
  summary.byMajor = [...majors.values()].sort((a, b) => b.amount - a.amount);
  summary.byCategory = [...cats.values()].sort((a, b) => b.amount - a.amount);
  return summary;
}

export type CategoryChange = { categoryId: string; previous: number; current: number; difference: number };

/** 두 기간(또는 두 점검)을 소분류 단위로 비교. 변화가 큰 순. 양쪽 다 0인 소분류는 뺀다. */
export function compareSummaries(previous: FlowSummary, current: FlowSummary): CategoryChange[] {
  const prev = new Map(previous.byCategory.map((row) => [row.categoryId, row.amount]));
  const curr = new Map(current.byCategory.map((row) => [row.categoryId, row.amount]));
  return [...new Set([...prev.keys(), ...curr.keys()])]
    .map((categoryId) => ({ categoryId, previous: prev.get(categoryId) ?? 0, current: curr.get(categoryId) ?? 0, difference: (curr.get(categoryId) ?? 0) - (prev.get(categoryId) ?? 0) }))
    .filter((row) => row.previous !== 0 || row.current !== 0)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/** 비정기 지출: 1년에 낼 총액과 나가는 달. 월 금액은 총액 ÷ 12로 평소에 떼어 둔다. */
export type IrregularItem = { categoryId: string; label: string; yearlyAmount: number; months: number[]; payment?: Payment; cut?: CutLevel; mustPart?: number };

export function irregularMonthly(item: IrregularItem): number {
  return Math.round(Math.max(0, item.yearlyAmount) / 12);
}

/** 지금 상태 점검 입력. 변동지출은 최근 1~3개월 평균(또는 빠른 기록 합계)을 월 금액으로 넣는다. */
export type FlowCheckInput = {
  monthlyIncome: number;
  fixed: FlowItem[];
  variable: FlowItem[];
  irregular: IrregularItem[];
  /** 매달 비상자금으로 따로 떼는 금액 */
  reserveMonthly: number;
};

export type FlowCheckResult = {
  summary: FlowSummary;
  /** 지금 투자 가능액 = 수입 − 현금 지출 − 비상자금 적립 (꾸준한 포인트는 계속 들어온다고 본다) */
  available: number;
  /** "이번만" 포인트·환급이 끊기면: 그 소비가 현금이 된다 */
  availableWithoutOncePoints: number;
  /** 포인트·환급이 전부 없으면 */
  availableWithoutPoints: number;
  /** 최대로 줄이면 = 수입 − 현금 지출 중 못 줄임 − 비상자금 적립. 투자 가능액의 상한 */
  maxIfCut: number;
  /** 줄일 여지 = 현금 지출 중 줄일 수 있음 + 끊을 수 있음 */
  room: number;
  /** 줄일 여지가 큰 소분류 순(현금 기준) */
  topCuttable: Array<{ categoryId: string; trim: number; drop: number }>;
  /** 비상자금 기준 한 달치 = 못 줄이는 소비(포인트 포함). 화면에서 × 3~6개월 */
  mustMonthly: number;
  /** 고정지출 ÷ 전체 소비 (0~1). 소비가 0이면 null */
  fixedRatio: number | null;
  /** 이번 달(month: 1~12)에 실제로 나갈 비정기 지출 — 평소 월할과 달리 목돈이 필요한 달 확인용 */
  irregularDueByMonth: Record<number, number>;
};

export function evaluateFlowCheck(input: FlowCheckInput): FlowCheckResult {
  const irregularAsItems: FlowItem[] = input.irregular.map((item) => ({
    categoryId: item.categoryId, amount: irregularMonthly(item), payment: item.payment, cut: item.cut,
    mustPart: item.mustPart === undefined ? undefined : Math.round(item.mustPart / 12), label: item.label,
  }));
  const all = [...input.fixed, ...input.variable, ...irregularAsItems];
  const summary = summarizeItems(all);
  const income = Math.max(0, input.monthlyIncome);
  const reserve = Math.max(0, input.reserveMonthly);
  const available = income - summary.cash - reserve;
  const cuttable = new Map<string, { categoryId: string; trim: number; drop: number }>();
  for (const item of all) {
    const payment = item.payment ?? "cash";
    if (payment !== "cash" && !isRefund(payment)) continue;
    const split = splitByCut(item);
    if (split.trim + split.drop === 0) continue;
    const sign = isRefund(payment) ? -1 : 1;
    const row = cuttable.get(item.categoryId) ?? { categoryId: item.categoryId, trim: 0, drop: 0 };
    row.trim += sign * split.trim;
    row.drop += sign * split.drop;
    cuttable.set(item.categoryId, row);
  }
  const irregularDueByMonth: Record<number, number> = {};
  for (const item of input.irregular) {
    const months = [...new Set(item.months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))];
    if (months.length === 0) continue;
    // 총액을 나가는 달 수로 나눈다(나머지는 첫 달에). 1년에 한 번이면 그 달에 전액.
    const base = Math.floor(item.yearlyAmount / months.length);
    months.sort((a, b) => a - b).forEach((month, i) => {
      irregularDueByMonth[month] = (irregularDueByMonth[month] ?? 0) + base + (i === 0 ? item.yearlyAmount - base * months.length : 0);
    });
  }
  return {
    summary,
    available,
    availableWithoutOncePoints: available - summary.pointOnce - summary.refundOnce,
    availableWithoutPoints: available - summary.pointOnce - summary.pointRegular - summary.refundOnce - summary.refundRegular,
    maxIfCut: income - summary.cashByCut.must - reserve,
    room: summary.cashByCut.trim + summary.cashByCut.drop,
    topCuttable: [...cuttable.values()].map((r) => ({ ...r, trim: Math.max(0, r.trim), drop: Math.max(0, r.drop) })).filter((r) => r.trim + r.drop > 0).sort((a, b) => b.trim + b.drop - (a.trim + a.drop)),
    mustMonthly: summary.consumptionByCut.must,
    fixedRatio: summary.consumption > 0 ? summary.byKind.fixed / summary.consumption : null,
    irregularDueByMonth,
  };
}

/** 시드 만들기 지출 칸으로 넘길 금액(포인트 제외, 환급은 뺀 현금 기준). 시드 만들기는 통장 흐름을 다룬다. */
export function toSeedExpenses(items: FlowItem[]): Record<SeedExpenseKey, number> {
  const out: Record<SeedExpenseKey, number> = { food: 0, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: 0 };
  for (const item of items) {
    const category = categoryById(item.categoryId) ?? categoryById(FALLBACK_CATEGORY_ID)!;
    out[category.seed] += cashEffect(item);
  }
  for (const key of Object.keys(out) as SeedExpenseKey[]) out[key] = Math.max(0, out[key]);
  return out;
}
