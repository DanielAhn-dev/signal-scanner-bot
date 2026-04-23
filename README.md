# signal-scanner-bot

## 운영 가이드

- 통합 운영 가이드 원본: [docs/user-operating-guide.md](docs/user-operating-guide.md)
- Telegram 버튼 프리셋 가이드: [docs/button-presets.md](docs/button-presets.md)
- 온보딩·기능개선 로드맵: [docs/onboarding-roadmap.md](docs/onboarding-roadmap.md)
- 가상 자동매매 운영 가이드: [docs/virtual-autotrade-ops.md](docs/virtual-autotrade-ops.md)
- Worker 관측/운영 가이드: [docs/worker-observability-guide.md](docs/worker-observability-guide.md)

### 운영 가이드 PDF 생성

```bash
pnpm docs:guide:pdf
```

```bash
pnpm docs:guide:pdf:check
```

- 입력 문서: `docs/user-operating-guide.md`
- 출력 PDF: `docs/generated/user-operating-guide.pdf`
- 체크 모드: 문서와 PDF가 불일치하면 실패

## 리포트 명령

- /리포트: 가능한 리포트 종류와 버튼 메뉴 표시
- /리포트 가이드: 기능 활용 운영 가이드 PDF
- /가이드pdf: 운영 가이드 PDF 바로 받기
- /리포트 주간: 시장 + 포트폴리오 종합 PDF
- /리포트 포트폴리오: 보유 종목/거래 중심 PDF
- /리포트 거시: 거시 지표 PDF
- /리포트 수급: 자금 흐름 PDF
- /리포트 섹터: 섹터 강도 PDF

## 자동 운영 알림

- 평일 장시작 전(08:30 KST) 브리핑 자동 발송
- 평일 장마감 직후(15:10 KST) 마감 브리핑 자동 발송
- 브리핑 하단에 운영 상태 체크(데이터 신선도, 가상자동매매 실행 현황, 큐 대기 건수, 자동화 처리량 추정)가 포함됩니다.
- 자동화 처리량 예산 기준이 필요하면 `AUTOMATION_DAILY_BUDGET` 환경변수를 설정하세요.
