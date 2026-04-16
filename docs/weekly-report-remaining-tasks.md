# Weekly Report Remaining Tasks

- Date: 2026-04-17
- Scope boundary: weeklyReportService.ts 작업 우선 마무리 완료
- Resume point: 아래 항목부터 순차 진행

## Remaining Checklist

- [ ] 수직정렬 공식 통일 및 ReportTheme 재설계 최종 점검
  - 현재 상태: weeklyReportService.ts 내 vCenterTopY 도입 및 getReportTheme/createReportTheme 1차 반영됨
  - 재개 시 할 일: 전체 섹션(cover/hero/header/table/comment/footer)의 y 계산식 일관성 최종 확인

- [ ] renderReportPdf 내부 함수 분리(export)
  - 목표: DB 조회(createWeeklyReportPdf)와 렌더링 로직 분리
  - 제안 인터페이스: renderReportPdf(input) => bytes/caption/summary 메타

- [ ] previewReport.ts 스크립트 생성
  - 목표: Supabase 없이 economy 주제 mock 데이터로 PDF 생성
  - 출력 파일 예시: preview_economy_report.pdf

- [ ] 로컬 미리보기 실행 및 타입 검증
  - 실행: npx tsx scripts/previewReport.ts
  - 검증: pnpm verify:vercel

## Notes For Resume

- Pretendard 폰트 파일은 assets/fonts 경로에 반영되어 있음
- weeklyReportService.ts는 현재 타입 오류 없음
- 다음 작업 시작 파일:
  - src/services/weeklyReportService.ts
  - scripts/previewReport.ts (신규)
