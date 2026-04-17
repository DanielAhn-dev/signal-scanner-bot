export type FundamentalProfile = {
  key: "default" | "growth" | "semiconductor" | "assetHeavy";
  label: string;
  note: string;
  per: {
    attractiveMax: number;
    neutralMax: number;
    expensiveMin: number;
  };
  pbr: {
    attractiveMax: number;
    neutralMax: number;
    expensiveMin: number;
  };
  roe: {
    strongMin: number;
    solidMin: number;
    weakMax: number;
  };
};

function normalizeProfileText(value?: string): string {
  return (value || "").replace(/\s+/g, "").trim();
}

export function normalizeSectorName(sectorName?: string): string | undefined {
  const raw = (sectorName || "").replace(/\s+/g, " ").trim();
  if (!raw) return undefined;

  const stripped = raw
    .replace(/코스피\s*200\s*TOP\s*10/gi, "")
    .replace(/코스피\s*200\s*비중상한\s*20%/gi, "")
    .replace(/코스피200제외\s*코스피지수/gi, "")
    .replace(/코스닥\s*150\s*/gi, "")
    .replace(/코스피\s*200\s*/gi, "")
    .replace(/코스피/gi, "")
    .replace(/코스닥/gi, "")
    .replace(/TOP\s*10/gi, "")
    .replace(/비중상한\s*20%/gi, "")
    .replace(/지수/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || undefined;
}

export function normalizeSectorCategory(category?: string): string | undefined {
  const normalized = normalizeProfileText(category);
  return normalized || undefined;
}

const DEFAULT_PROFILE: FundamentalProfile = {
  key: "default",
  label: "일반주",
  note: "일반 제조·소비재 기준의 기본 밸류 임계값을 적용합니다.",
  per: { attractiveMax: 12, neutralMax: 25, expensiveMin: 35 },
  pbr: { attractiveMax: 1.2, neutralMax: 2.0, expensiveMin: 3.0 },
  roe: { strongMin: 15, solidMin: 10, weakMax: 5 },
};

const GROWTH_PROFILE: FundamentalProfile = {
  key: "growth",
  label: "성장주",
  note: "인터넷·소프트웨어·콘텐츠·바이오 계열은 성장 기대를 반영해 PER/PBR 허용 폭을 더 넓게 봅니다.",
  per: { attractiveMax: 18, neutralMax: 35, expensiveMin: 45 },
  pbr: { attractiveMax: 1.8, neutralMax: 3.5, expensiveMin: 5.0 },
  roe: { strongMin: 12, solidMin: 7, weakMax: 3 },
};

const SEMICONDUCTOR_PROFILE: FundamentalProfile = {
  key: "semiconductor",
  label: "반도체/고성능부품",
  note: "반도체는 이익 변동성이 커서 PBR과 ROE를 함께 보고, 업황 저점·고점에 따라 PER 왜곡이 잦습니다.",
  per: { attractiveMax: 10, neutralMax: 22, expensiveMin: 32 },
  pbr: { attractiveMax: 1.5, neutralMax: 3.5, expensiveMin: 5.5 },
  roe: { strongMin: 18, solidMin: 10, weakMax: 4 },
};

const ASSET_HEAVY_PROFILE: FundamentalProfile = {
  key: "assetHeavy",
  label: "금융/자산주",
  note: "은행·보험·증권·통신·유틸리티는 자산 기반 업종이라 PBR과 안정성 비중을 더 크게 봅니다.",
  per: { attractiveMax: 8, neutralMax: 15, expensiveMin: 20 },
  pbr: { attractiveMax: 0.9, neutralMax: 1.3, expensiveMin: 2.0 },
  roe: { strongMin: 12, solidMin: 8, weakMax: 4 },
};

const GROWTH_PATTERNS = [
  /소프트웨어/,
  /인터넷/,
  /게임/,
  /광고/,
  /미디어/,
  /엔터/,
  /콘텐츠/,
  /플랫폼/,
  /바이오/,
  /제약/,
  /의료기기/,
  /헬스케어/,
  /healthcare/i,
  /biotech/i,
  /software/i,
  /internet/i,
  /건강관리/,
  /교육서비스/,
];

const SEMICONDUCTOR_PATTERNS = [
  /반도체/,
  /메모리/,
  /디스플레이장비/,
  /전자장비/,
  /전자부품/,
  /semiconductor/i,
  /memory/i,
];

const ASSET_HEAVY_PATTERNS = [
  /은행/,
  /보험/,
  /증권/,
  /카드/,
  /통신서비스/,
  /유틸리티/,
  /전력/,
  /가스/,
  /리츠/,
  /financial/i,
  /bank/i,
  /insurance/i,
  /utility/i,
];

export function resolveFundamentalProfile(input?: {
  sectorName?: string;
  sectorCategory?: string;
}): FundamentalProfile {
  const sector = normalizeProfileText(normalizeSectorName(input?.sectorName));
  const category = normalizeSectorCategory(input?.sectorCategory);
  const candidates = [sector, category].filter(Boolean) as string[];
  if (!candidates.length) return DEFAULT_PROFILE;
  if (candidates.some((value) => SEMICONDUCTOR_PATTERNS.some((pattern) => pattern.test(value)))) {
    return SEMICONDUCTOR_PROFILE;
  }
  if (candidates.some((value) => ASSET_HEAVY_PATTERNS.some((pattern) => pattern.test(value)))) {
    return ASSET_HEAVY_PROFILE;
  }
  if (candidates.some((value) => GROWTH_PATTERNS.some((pattern) => pattern.test(value)))) {
    return GROWTH_PROFILE;
  }
  return DEFAULT_PROFILE;
}