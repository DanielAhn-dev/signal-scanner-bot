# Telegram ↔ Web 기능 갭 분석

- 기준일: 2026-05-06
- 목적: 텔레그램 명령어 기준으로 웹 구현 상태를 분류하고, 미구현 우선순위를 확정
- 기준 소스:
  - 텔레그램 명령 목록: src/bot/commandCatalog.ts, web/src/data/telegramCommands.ts
  - 웹 라우트/기능: web/src/App.tsx, web/src/navigation.ts, web/src/features/*

## 상태 분류 기준

- 구현: 웹 메뉴 또는 화면에서 명령의 핵심 목적을 바로 수행 가능
- 부분 구현: 조회는 가능하나 실행/관리(편집/초기화/자동화)가 부족
- 미구현: 웹에서 직접 기능을 수행할 수 없음

## 1) 구현 완료 (웹 대응 있음)

- /scan, /analyze, /sector, /economy, /market, /news, /feed
- /watchlist, /watchadd, /watchremove (관심 목록 관리)
- /holdings, /paperbuy, /papersell (포트폴리오/가상매매)
- /tradelog (거래 기록/결정 로그)
- /alert, /report, /guidepdf
- /profile (웹 프로필 모달 + 연동 보조)

## 2) 부분 구현 (핵심은 있으나 운영 기능 부족)

- /brief
  - 현재: 리포트 화면에서 트리거 가능
  - 부족: 브리핑 전용 화면/히스토리/실행 결과 뷰 부재
- /premarket
  - 현재: 일부 리포트/운영 흐름에 포함
  - 부족: 장전플랜 전용 화면/체크리스트/체결 가정 시뮬레이션 부재
- /capital
  - 현재: 설정 일부 존재
  - 부족: 투자금 설정 전체 필드와 검증 UX 일원화 필요
- /report (주간/월간/추천/가이드)
  - 현재: 다운로드/웹보기/공유 중심
  - 부족: 토픽별 실행 이력, 실패 원인 안내, 재실행 정책 UI 필요

## 3) 미구현 (웹에서 직접 수행 불가)

### A. 포지션 운영/보수 작업
- /watchreset (관심 목록 일괄 초기화)
- /watchplan (관심 종목 대응 플랜)
- /holdingedit (보유 단가·수량 수정)
- /holdingrestore (누락 보유 복구)
- /liquidateall (전체 매도)
- /holdingplan (보유 대응 플랜)

### B. 자동화 운영
- /autosellcheck (자동 매도 점검)
- /autocycle (점검/실행/진입)
- /autotrigger (장중/장전 단계 트리거)
- /weekly (주간 코파일럿 전용 워크플로우)

### C. ETF/추천 특화
- /kospi, /kosdaq
- /etf, /etfhub, /etfcore, /etftheme
- /etfinfo, /etfdiv
- /nextsector, /pullback (전용 운영 화면 기준)

### D. 소셜
- /follow, /unfollow

## 4) 구현 우선순위 제안

## P0 (즉시)
- watchreset, holdingedit, liquidateall
- 이유: 사용자 조작 빈도 높고 텔레그램 의존도가 큼

## P1 (자동화)
- autocycle, autotrigger, autosellcheck
- 이유: 웹 운영 관점 핵심. 실행 이력/실패 원인까지 묶어야 운영 가능

## P2 (플랜)
- watchplan, holdingplan, premarket
- 이유: 의사결정 보조 강화를 위한 핵심 UX

## P3 (확장)
- ETF 허브/추천 세트, follow/unfollow

## 5) 제안 화면 구성

- Operations 페이지(신규): autocycle/autotrigger/autosellcheck, 실행 이력, 실패 원인
- Position Maintenance 페이지(신규): holdingedit/holdingrestore/liquidateall/watchreset
- Plan Center 페이지(신규): premarket/watchplan/holdingplan 카드형 워크플로우
- ETF Hub 페이지(신규): etfcore/etftheme/etfinfo/etfdiv 탭

## 6) 다음 구현 단위(작업 티켓화 권장)

1. Position Maintenance MVP
- watchreset, holdingedit, liquidateall API 연결 + 확인 모달 + 감사 로그 노출

2. Operations MVP
- autocycle 점검/실행 버튼, autotrigger 단계 실행, 최근 20건 이력

3. Plan Center MVP
- 관심/보유 대응 플랜 조회, 장전플랜 생성/복사

4. ETF Hub MVP
- 추천/정보/분배금 탭 + 검색

---

이 문서는 기능 범위 합의용이며, 실제 구현 시 API 가용성/권한 모델(관리자/일반 사용자)을 함께 확정해야 한다.
