// src/bot/messages/ko.ts
import { buildHelpMessage, buildUnknownCommandMessage } from "../commandCatalog";

export const KO_MESSAGES = {
  START:
    "Signal Scanner Bot\n" +
    "─────────────────\n" +
    "명령어 목록\n" +
    "/온보딩 — 초보자 조회 순서/리스크 가이드\n" +
    "/섹터 — 주도 섹터 랭킹\n" +
    "/다음섹터 — 수급 유입 섹터\n" +
    "/종목 <섹터> — 섹터별 대장주\n" +
    "/스캔 [섹터] — 눌림목 스캐너\n" +
    "/점수 <이름|코드> — 종목 점수·시그널\n" +
    "/매수 <이름|코드> — 진입/손절/익절 레벨\n" +
    "/재무 <이름|코드> — PER/PBR/ROE/부채비율 요약\n" +
    "/투자금 [금액] [분할횟수] [목표수익률] — 매수 계획 설정\n" +
    "/브리핑 — 장전 브리핑\n" +
    "/리포트 — 가능한 리포트 종류 안내\n" +
    "/리포트 주간|포트폴리오|거시|수급|섹터 — PDF 리포트\n" +
    "/kospi 또는 코스피 — 코스피 보수형 추천 TOP5\n" +
    "/kosdaq 또는 코스닥 — 코스닥 보수형 추천 TOP5\n" +
    "/etf — ETF 허브\n" +
    "/etfhub — ETF 허브 별칭\n" +
    "/알림 — 이상징후 점검(경량)\n" +
    "/눌림목 — 눌림목 매집 후보\n" +
    "/관심 — 관심종목 포트폴리오\n" +
    "/기록 — 가상 매매 기록\n" +
    "/수급 [종목] — 외국인·기관 매매동향\n" +
    "/경제 — 글로벌 경제지표\n" +
    "/뉴스 [종목] — 시장·종목 뉴스\n" +
    "/시장 — 종합 시장 진단\n" +
    "/프로필 — 내 사용 통계\n" +
    "/랭킹 — 포트폴리오 수익률 순위\n" +
    "/팔로우 @닉네임 — 트레이더 팔로우\n" +
    "/피드 — 팔로잉 피드",
  HELP: buildHelpMessage(),
  UNKNOWN_COMMAND: buildUnknownCommandMessage(),
  SECTOR_ERROR:
    "섹터 데이터 수집 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.",
  STOCKS_EMPTY: "해당 섹터의 종목이 없습니다.\n전체 상위 종목을 표시합니다.",
  SCORE_NOT_FOUND: "종목을 찾을 수 없습니다.\n종목명 또는 코드를 확인해주세요.",
  INSUFFICIENT: "데이터가 부족합니다 (100봉 미만).\n잠시 후 다시 시도해주세요.",
};
