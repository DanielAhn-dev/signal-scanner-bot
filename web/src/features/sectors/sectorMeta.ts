/**
 * 섹터 메타데이터 — 정적 데이터 (프론트엔드 하드코딩)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 백엔드 API 교체 가이드
 *
 * 현재: import { SECTOR_META_DATA, ROTATION_CYCLE, MACRO_SENSITIVITY } from './sectorMeta'
 *
 * 교체 시 API 계약:
 *   GET /api/ui/sector-meta
 *   → { sectors: SectorMeta[], rotationCycle: RotationPhase[], macroSensitivity: MacroSensitivity, currentPhase?: EconomicPhase }
 *
 * 교체 절차:
 *   1. 위 엔드포인트 구현
 *   2. SectorsPage 에서 useSectorMeta() 훅으로 fetch (currentPhase 관리자 설정 포함)
 *   3. 이 파일의 상수 3개를 훅 반환값으로 교체
 *   4. 응답 구조가 아래 타입과 동일하면 UI 변경 없음
 * ─────────────────────────────────────────────────────────────────────────
 */

export type SectorNature = "cyclical" | "defensive" | "interest_sensitive" | "growth"
export type EconomicPhase = "recovery" | "expansion" | "slowdown" | "recession"

export interface SectorMeta {
  name: string              // Sector.name 과 일치 (매칭 키)
  wicsCategory: string      // WICS 대분류
  nature: SectorNature
  description: string       // 한 줄 설명
  industries: string[]      // 대표 산업 키워드
  favorablePhases: EconomicPhase[]
}

export interface RotationPhase {
  phase: EconomicPhase
  label: string
  shortLabel: string
  emoji: string
  description: string
  sectorCategories: string[]  // WICS 대분류명
  indicators: string[]        // 이 국면을 판단하는 경기 지표
}

export interface MacroSensitivity {
  rateUp:      { favorable: string[]; unfavorable: string[] }
  rateDown:    { favorable: string[]; unfavorable: string[] }
  inflationUp: { favorable: string[]; unfavorable: string[] }
}

// ── 섹터별 메타데이터 ─────────────────────────────────────────────────────

export const SECTOR_META_DATA: SectorMeta[] = [
  // 건강관리
  { name: "건강관리기술",        wicsCategory: "건강관리",   nature: "defensive",           description: "의료 IT·디지털 헬스케어",       industries: ["디지털헬스","의료정보"],    favorablePhases: ["slowdown","recession"] },
  { name: "건강관리업체및서비스", wicsCategory: "건강관리",   nature: "defensive",           description: "병원·의료서비스 운영",          industries: ["병원","의료서비스"],       favorablePhases: ["slowdown","recession"] },
  { name: "건강관리장비와용품",   wicsCategory: "건강관리",   nature: "defensive",           description: "의료기기·진단장비",             industries: ["의료기기","진단"],         favorablePhases: ["slowdown","recession"] },
  { name: "생명과학도구및서비스", wicsCategory: "건강관리",   nature: "defensive",           description: "연구장비·임상지원 서비스",       industries: ["생명과학","연구장비"],     favorablePhases: ["slowdown","recession"] },
  { name: "생물공학",            wicsCategory: "건강관리",   nature: "defensive",           description: "바이오 신약·치료제 개발",        industries: ["바이오","신약"],           favorablePhases: ["slowdown","recession"] },
  { name: "제약",                wicsCategory: "건강관리",   nature: "defensive",           description: "의약품 제조·판매",              industries: ["제약","의약품"],           favorablePhases: ["slowdown","recession"] },

  // 소재
  { name: "건축자재",            wicsCategory: "소재",       nature: "cyclical",            description: "시멘트·레미콘 등 건자재",        industries: ["시멘트","레미콘"],         favorablePhases: ["recovery","expansion"] },
  { name: "건축제품",            wicsCategory: "소재",       nature: "cyclical",            description: "창호·단열재 등 건축 완성재",     industries: ["창호","단열"],            favorablePhases: ["recovery","expansion"] },
  { name: "비철금속",            wicsCategory: "소재",       nature: "cyclical",            description: "알루미늄·구리 등 비철금속",      industries: ["알루미늄","구리"],         favorablePhases: ["recovery","expansion"] },
  { name: "철강",                wicsCategory: "소재",       nature: "cyclical",            description: "철강·강판 생산",               industries: ["철강","강판"],            favorablePhases: ["recovery","expansion"] },
  { name: "종이와목재",          wicsCategory: "소재",       nature: "cyclical",            description: "펄프·종이·목재 소재",           industries: ["펄프","종이"],            favorablePhases: ["recovery"] },
  { name: "포장재",              wicsCategory: "소재",       nature: "defensive",           description: "소비재 포장 솔루션",            industries: ["포장","필름"],            favorablePhases: ["expansion","slowdown"] },
  { name: "화학",                wicsCategory: "소재",       nature: "cyclical",            description: "석유화학·정밀화학",             industries: ["석화","정밀화학"],         favorablePhases: ["recovery","expansion"] },

  // 산업재
  { name: "건설",                wicsCategory: "산업재",     nature: "cyclical",            description: "건설·토목·인프라",              industries: ["건설","토목"],            favorablePhases: ["recovery","expansion"] },
  { name: "기계",                wicsCategory: "산업재",     nature: "cyclical",            description: "일반기계·공작기계",             industries: ["기계","공작기계"],         favorablePhases: ["expansion"] },
  { name: "도로와철도운송",       wicsCategory: "산업재",     nature: "cyclical",            description: "육상 운송·물류",               industries: ["운송","물류"],            favorablePhases: ["recovery","expansion"] },
  { name: "상업서비스와공급품",   wicsCategory: "산업재",     nature: "cyclical",            description: "B2B 서비스·사무용품 공급",      industries: ["B2B서비스"],              favorablePhases: ["expansion"] },
  { name: "우주항공과국방",       wicsCategory: "산업재",     nature: "cyclical",            description: "항공기·방산 시스템",            industries: ["방산","항공"],            favorablePhases: ["expansion"] },
  { name: "운송인프라",          wicsCategory: "산업재",     nature: "cyclical",            description: "항만·공항·물류인프라",          industries: ["항만","공항"],            favorablePhases: ["recovery","expansion"] },
  { name: "전기장비",            wicsCategory: "산업재",     nature: "cyclical",            description: "전력기기·배전설비",             industries: ["전력기기","배전"],         favorablePhases: ["recovery","expansion"] },
  { name: "조선",                wicsCategory: "산업재",     nature: "cyclical",            description: "선박 건조·해양플랜트",          industries: ["조선","해양"],            favorablePhases: ["expansion"] },
  { name: "항공사",              wicsCategory: "산업재",     nature: "cyclical",            description: "여객·화물 항공 운송",           industries: ["항공","여행"],            favorablePhases: ["expansion"] },
  { name: "항공화물운송과물류",   wicsCategory: "산업재",     nature: "cyclical",            description: "항공화물·글로벌 물류",          industries: ["물류","항공화물"],         favorablePhases: ["expansion"] },
  { name: "해운사",              wicsCategory: "산업재",     nature: "cyclical",            description: "해상 운송·컨테이너",            industries: ["해운","컨테이너"],         favorablePhases: ["expansion"] },
  { name: "복합기업",            wicsCategory: "산업재",     nature: "cyclical",            description: "다각화 대기업 지주사",           industries: ["지주사","복합"],          favorablePhases: ["recovery","expansion"] },
  { name: "무역회사와판매업체",   wicsCategory: "산업재",     nature: "cyclical",            description: "종합무역·도소매",               industries: ["무역","도매"],            favorablePhases: ["expansion"] },

  // 경기소비재
  { name: "가구",                wicsCategory: "경기소비재",  nature: "cyclical",            description: "가구·인테리어 제품",            industries: ["가구","인테리어"],         favorablePhases: ["expansion"] },
  { name: "가정용기기와용품",     wicsCategory: "경기소비재",  nature: "cyclical",            description: "가전·생활가전",                industries: ["가전"],                   favorablePhases: ["expansion"] },
  { name: "게임엔터테인먼트",     wicsCategory: "경기소비재",  nature: "cyclical",            description: "온라인·모바일 게임",            industries: ["게임","엔터"],            favorablePhases: ["expansion"] },
  { name: "다각화된소비자서비스", wicsCategory: "경기소비재",  nature: "cyclical",            description: "렌털·구독·소비자서비스",        industries: ["서비스","렌털"],          favorablePhases: ["expansion"] },
  { name: "레저용장비와제품",     wicsCategory: "경기소비재",  nature: "cyclical",            description: "스포츠·레저 장비",              industries: ["스포츠","레저"],          favorablePhases: ["expansion"] },
  { name: "방송과엔터테인먼트",   wicsCategory: "경기소비재",  nature: "cyclical",            description: "방송·콘텐츠·엔터테인먼트",      industries: ["방송","콘텐츠"],          favorablePhases: ["expansion"] },
  { name: "백화점과일반상점",     wicsCategory: "경기소비재",  nature: "cyclical",            description: "백화점·종합소매",               industries: ["백화점","소매"],          favorablePhases: ["expansion"] },
  { name: "섬유,의류,신발,호화품", wicsCategory: "경기소비재", nature: "cyclical",            description: "의류·명품·패션",               industries: ["의류","패션","명품"],     favorablePhases: ["expansion"] },
  { name: "양방향미디어와서비스", wicsCategory: "경기소비재",  nature: "growth",              description: "인터넷 플랫폼·SNS",            industries: ["플랫폼","SNS"],           favorablePhases: ["expansion"] },
  { name: "자동차",              wicsCategory: "경기소비재",  nature: "cyclical",            description: "완성차 제조·판매",              industries: ["자동차"],                 favorablePhases: ["recovery","expansion"] },
  { name: "자동차부품",          wicsCategory: "경기소비재",  nature: "cyclical",            description: "자동차 부품·모듈",              industries: ["부품","모듈"],            favorablePhases: ["recovery","expansion"] },
  { name: "전문소매",            wicsCategory: "경기소비재",  nature: "cyclical",            description: "전문점·카테고리킬러",           industries: ["전문소매"],               favorablePhases: ["expansion"] },
  { name: "호텔,레스토랑,레저",  wicsCategory: "경기소비재",  nature: "cyclical",            description: "호텔·외식·여가",               industries: ["호텔","외식"],            favorablePhases: ["expansion"] },
  { name: "인터넷과카탈로그소매", wicsCategory: "경기소비재",  nature: "growth",              description: "이커머스·온라인쇼핑",           industries: ["이커머스","쇼핑"],         favorablePhases: ["expansion"] },
  { name: "광고",                wicsCategory: "경기소비재",  nature: "cyclical",            description: "광고대행·마케팅서비스",         industries: ["광고","마케팅"],          favorablePhases: ["expansion"] },

  // 필수소비재
  { name: "담배",                wicsCategory: "필수소비재",  nature: "defensive",           description: "담배·흡연 제품",               industries: ["담배"],                   favorablePhases: ["slowdown","recession"] },
  { name: "식품",                wicsCategory: "필수소비재",  nature: "defensive",           description: "식품 제조·가공",               industries: ["식품","가공"],            favorablePhases: ["slowdown","recession"] },
  { name: "식품과기본식료품소매", wicsCategory: "필수소비재",  nature: "defensive",           description: "마트·슈퍼 식료품 소매",         industries: ["마트","슈퍼"],            favorablePhases: ["slowdown","recession"] },
  { name: "음료",                wicsCategory: "필수소비재",  nature: "defensive",           description: "음료·주류 제조",               industries: ["음료","주류"],            favorablePhases: ["slowdown","recession"] },
  { name: "화장품",              wicsCategory: "필수소비재",  nature: "defensive",           description: "화장품·미용 제품",              industries: ["화장품","뷰티"],          favorablePhases: ["slowdown","recession"] },
  { name: "가정용품",            wicsCategory: "필수소비재",  nature: "defensive",           description: "세제·생필품 제조",              industries: ["생필품","세제"],          favorablePhases: ["slowdown","recession"] },
  { name: "판매업체",            wicsCategory: "필수소비재",  nature: "defensive",           description: "도소매 유통",                  industries: ["유통"],                   favorablePhases: ["slowdown"] },

  // 금융
  { name: "은행",                wicsCategory: "금융",       nature: "interest_sensitive",  description: "시중·지방·인터넷은행",          industries: ["은행"],                   favorablePhases: ["recovery","expansion"] },
  { name: "카드",                wicsCategory: "금융",       nature: "interest_sensitive",  description: "신용카드·할부금융",             industries: ["카드","할부"],            favorablePhases: ["expansion"] },
  { name: "증권",                wicsCategory: "금융",       nature: "interest_sensitive",  description: "증권사·투자은행(IB)",           industries: ["증권","IB"],              favorablePhases: ["recovery","expansion"] },
  { name: "창업투자",            wicsCategory: "금융",       nature: "interest_sensitive",  description: "벤처캐피탈·PE",                industries: ["VC","PE"],               favorablePhases: ["expansion"] },
  { name: "기타금융",            wicsCategory: "금융",       nature: "interest_sensitive",  description: "기타 금융회사",                industries: ["금융"],                   favorablePhases: ["expansion"] },
  { name: "손해보험",            wicsCategory: "금융",       nature: "interest_sensitive",  description: "손해보험·재보험",               industries: ["보험"],                   favorablePhases: ["recovery","expansion"] },
  { name: "생명보험",            wicsCategory: "금융",       nature: "interest_sensitive",  description: "생명보험·연금",                industries: ["보험","연금"],            favorablePhases: ["recovery","expansion"] },

  // IT
  { name: "반도체와반도체장비",   wicsCategory: "IT",         nature: "growth",              description: "반도체 설계·제조·장비",         industries: ["반도체","팹리스"],         favorablePhases: ["recovery","expansion"] },
  { name: "소프트웨어",          wicsCategory: "IT",         nature: "growth",              description: "소프트웨어 개발·SaaS",          industries: ["SW","SaaS"],             favorablePhases: ["expansion"] },
  { name: "IT서비스",            wicsCategory: "IT",         nature: "growth",              description: "IT컨설팅·아웃소싱(SI)",         industries: ["SI","IT서비스"],          favorablePhases: ["expansion"] },
  { name: "컴퓨터와주변기기",     wicsCategory: "IT",         nature: "growth",              description: "PC·서버·주변기기",             industries: ["PC","서버"],              favorablePhases: ["expansion"] },
  { name: "전자장비와기기",       wicsCategory: "IT",         nature: "growth",              description: "계측기·산업전자",               industries: ["계측기","산업전자"],       favorablePhases: ["expansion"] },
  { name: "전자제품",            wicsCategory: "IT",         nature: "growth",              description: "소비자전자·가전",               industries: ["가전","전자"],            favorablePhases: ["expansion"] },
  { name: "통신장비",            wicsCategory: "IT",         nature: "growth",              description: "네트워크·통신장비",             industries: ["네트워크","통신장비"],     favorablePhases: ["expansion"] },
  { name: "디스플레이장비및부품", wicsCategory: "IT",         nature: "growth",              description: "디스플레이 제조장비",            industries: ["디스플레이"],             favorablePhases: ["recovery","expansion"] },
  { name: "디스플레이패널",       wicsCategory: "IT",         nature: "growth",              description: "LCD·OLED 패널",               industries: ["패널","OLED"],            favorablePhases: ["recovery","expansion"] },
  { name: "사무용전자제품",       wicsCategory: "IT",         nature: "growth",              description: "복합기·프린터",                industries: ["프린터","복합기"],         favorablePhases: ["expansion"] },
  { name: "핸드셋",              wicsCategory: "IT",         nature: "growth",              description: "스마트폰·이동통신기기",          industries: ["스마트폰"],               favorablePhases: ["expansion"] },

  // 통신서비스
  { name: "다각화된통신서비스",   wicsCategory: "통신서비스",  nature: "defensive",           description: "유선·위성·복합통신",            industries: ["통신","유선"],            favorablePhases: ["slowdown","recession"] },
  { name: "무선통신서비스",       wicsCategory: "통신서비스",  nature: "defensive",           description: "이동통신 3사",                 industries: ["이통사","5G"],            favorablePhases: ["slowdown","recession"] },
  { name: "출판",                wicsCategory: "통신서비스",  nature: "defensive",           description: "미디어 콘텐츠·출판",            industries: ["출판","미디어"],          favorablePhases: ["slowdown"] },

  // 유틸리티
  { name: "복합유틸리티",        wicsCategory: "유틸리티",    nature: "defensive",           description: "전기·가스 복합 공급",           industries: ["전기","가스"],            favorablePhases: ["recession","slowdown"] },
  { name: "전기유틸리티",        wicsCategory: "유틸리티",    nature: "defensive",           description: "발전·송배전",                  industries: ["전력","발전"],            favorablePhases: ["recession","slowdown"] },
  { name: "가스유틸리티",        wicsCategory: "유틸리티",    nature: "defensive",           description: "가스 공급·배관",               industries: ["가스"],                   favorablePhases: ["recession","slowdown"] },

  // 에너지
  { name: "석유와가스",          wicsCategory: "에너지",      nature: "cyclical",            description: "정유·가스 탐사·생산",           industries: ["정유","가스"],            favorablePhases: ["expansion"] },
  { name: "에너지장비및서비스",   wicsCategory: "에너지",      nature: "cyclical",            description: "에너지 플랜트·시추장비",         industries: ["플랜트","시추"],          favorablePhases: ["expansion"] },

  // 부동산
  { name: "부동산",              wicsCategory: "부동산",      nature: "interest_sensitive",  description: "리츠·부동산 개발·임대",          industries: ["리츠","부동산"],          favorablePhases: ["recovery"] },

  // 기타
  { name: "교육서비스",          wicsCategory: "기타",        nature: "defensive",           description: "교육·학원 서비스",              industries: ["교육"],                   favorablePhases: ["slowdown"] },
  { name: "문구류",              wicsCategory: "기타",        nature: "defensive",           description: "문구·사무용품",                industries: ["문구"],                   favorablePhases: ["slowdown"] },
  { name: "기타",                wicsCategory: "기타",        nature: "cyclical",            description: "분류 미정 섹터",               industries: [],                         favorablePhases: [] },
]

// ── 섹터 로테이션 사이클 ──────────────────────────────────────────────────
// 경기 국면 순서: 회복기 → 호황기 → 둔화기 → 침체기 → (반복)

export const ROTATION_CYCLE: RotationPhase[] = [
  {
    phase: "recovery",
    label: "회복기",
    shortLabel: "회복",
    emoji: "🌱",
    description: "경기침체 후 반등 시작. 금리 안정·소비 회복 기대감. 선행지표 상승.",
    sectorCategories: ["금융", "산업재", "소재"],
    indicators: ["ISM 제조업 반등", "장단기금리차 정상화", "소비자심리 회복"],
  },
  {
    phase: "expansion",
    label: "호황기",
    shortLabel: "호황",
    emoji: "🚀",
    description: "소비·투자 급증, 기업 실적 개선. 위험자산 선호. 물가 상승 시작.",
    sectorCategories: ["IT", "경기소비재", "에너지"],
    indicators: ["GDP 성장 가속", "실업률 하락", "CPI 상승 시작"],
  },
  {
    phase: "slowdown",
    label: "둔화기",
    shortLabel: "둔화",
    emoji: "🌥",
    description: "성장 정점 후 둔화. 금리 고점 유지·인플레 완화 중. 방어주 선호 증가.",
    sectorCategories: ["건강관리", "필수소비재", "유틸리티"],
    indicators: ["ISM 50선 하회", "소비 증가율 둔화", "기업 실적 하향"],
  },
  {
    phase: "recession",
    label: "침체기",
    shortLabel: "침체",
    emoji: "❄️",
    description: "경기 수축, 실업 증가. 금리 인하 시작. 안전자산·방어주 집중.",
    sectorCategories: ["유틸리티", "필수소비재", "통신서비스"],
    indicators: ["GDP 마이너스 성장", "금리 인하 시작", "신용스프레드 확대"],
  },
]

// ── 매크로 민감도 ─────────────────────────────────────────────────────────

export const MACRO_SENSITIVITY: MacroSensitivity = {
  rateUp: {
    favorable:   ["금융", "은행", "보험"],
    unfavorable: ["IT·성장주", "부동산", "유틸리티"],
  },
  rateDown: {
    favorable:   ["부동산", "유틸리티", "IT·성장주"],
    unfavorable: ["은행", "보험"],
  },
  inflationUp: {
    favorable:   ["에너지", "소재", "산업재"],
    unfavorable: ["경기소비재", "유틸리티"],
  },
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────

const META_MAP = new Map<string, SectorMeta>(SECTOR_META_DATA.map((m) => [m.name, m]))

export function getSectorMeta(name: string): SectorMeta | undefined {
  return META_MAP.get(name)
}

export const NATURE_LABELS: Record<SectorNature, string> = {
  cyclical:           "경기민감",
  defensive:          "방어주",
  interest_sensitive: "금리민감",
  growth:             "성장주",
}

export const PHASE_LABELS: Record<EconomicPhase, string> = {
  recovery:  "회복기",
  expansion: "호황기",
  slowdown:  "둔화기",
  recession: "침체기",
}

export const WICS_ORDER = ["IT", "반도체", "금융", "산업재", "경기소비재", "소재", "에너지", "건강관리", "필수소비재", "통신서비스", "유틸리티", "부동산", "기타"]
