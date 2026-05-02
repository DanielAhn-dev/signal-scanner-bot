# Telegram 명령 매핑표

이 문서는 저장소의 `src/bot/commandCatalog.ts`에 정의된 Telegram 명령 목록을 정리합니다.

| 명령 (command) | 설명 |
|---|---|
| start | 시작 · 메뉴 |
| weekly | 주간 코파일럿(브리핑·플랜·보유대응) |
| onboarding | 초보자 온보딩 가이드 |
| sector | 주도 섹터 랭킹 |
| scan | 눌림목 스캐너 |
| scanlog | 최근 스캔 로그 요약 |
| analyze | 종목 분석 |
| finance | 재무 요약 |
| capital | 투자금 설정 |
| brief | 장전 브리핑 |
| report | 리포트 도움말 · /리포트 추천·주간·월간 |
| guidepdf | 운영 가이드 PDF |
| alert | 이상징후 점검 |
| economy | 글로벌 경제지표 |
| news | 시장·종목 뉴스 |
| market | 종합 시장 진단 |
| watchlist | 관심 종목 추적 |
| watchadd | 관심 종목 추가 |
| watchremove | 관심 종목 제거 |
| watchreset | 관심 목록 초기화 |
| watchplan | 관심 종목 대응 플랜 |
| holdings | 가상 보유 포트폴리오 |
| paperbuy | 가상 매수 |
| papersell | 가상 매도 |
| liquidateall | 보유 포지션 전체매도 |
| holdingedit | 보유 단가·수량 수정 |
| holdingrestore | 누락 보유 포지션 복구 |
| autosellcheck | 자동 매도 점검 |
| autocycle | 자동사이클 점검·실행·진입 |
| autotrigger | 순차 트리거(장중/장전 단계 실행) |
| premarket | 장전 주문 플랜 |
| holdingplan | 보유 대응 플랜 |
| tradelog | 거래 기록 |
| flow | 외국인·기관 수급 |
| nextsector | 수급 유입 섹터 |
| pullback | 눌림목 매집 후보 |
| ranking | 포트폴리오 랭킹 |
| profile | 내 프로필 |
| follow | 트레이더 팔로우 |
| feed | 팔로잉 피드 |
| help | 도움말 |

참고: 추가적인 별칭, 콜백 변환 규칙, 도움말 내용은 `src/bot/commandCatalog.ts`의 `CALLBACK_COMMAND_TEXT`, `CALLBACK_PREFIX_TEXT`, `HELP_SECTIONS`, `PROMPT_PRESETS` 등을 참고하세요.
