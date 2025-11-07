// src/bot/messages/ko.ts
export const KO_MESSAGES = {
  START:
    "구독이 시작되었습니다.\n명령:\n/sector — 유망 섹터\n/stocks <섹터> — 대장주 후보\n/score <이름|코드> — 점수·레벨",
  HELP: "도움말:\n/sector — 유망 섹터\n/stocks <섹터>\n/score <이름|코드>",
  UNKNOWN_COMMAND:
    "알 수 없는 명령입니다.\n사용 가능: /sector, /stocks <섹터>, /score <이름|코드>",
  SECTOR_ERROR:
    "섹터 데이터 수집 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.",
  STOCKS_EMPTY: "해당 섹터의 종목이 없습니다.\n전체 상위 종목을 표시합니다.",
  SCORE_NOT_FOUND: "종목을 찾을 수 없습니다.\n종목명 또는 코드를 확인해주세요.",
  INSUFFICIENT: "데이터가 부족합니다 (100봉 미만).\n잠시 후 다시 시도해주세요.",
};
