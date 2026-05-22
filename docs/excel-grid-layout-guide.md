# Excel Grid Layout Guide

상태: Active
적용 범위: web/src/styles/layout/excel-shell.css 기반 모든 시트 페이지

## 1) 공통 기준 (Layout Contract)

- 기본 1행 높이: `--xls-grid-row-height` = `22px`
- 2행 병합 높이: `--xls-grid-row-height-double` = `44px`
- 셀 내용 라인높이: `--xls-grid-cell-line-height` = `20px`
- 셀 패딩: `--xls-grid-cell-padding-y` / `--xls-grid-cell-padding-x`

이 값들은 `web/src/styles/tokens.css`에서 관리한다.

## 2) 페이지 구현 규칙

- 페이지별로 행 높이를 하드코딩하지 않는다.
- `.xls-row`, `.xls-cell`의 높이/패딩/라인높이는 토큰만 사용한다.
- 더미행 계산 시 fallback rowHeight도 22px 기준을 사용한다.
- 행 번호 스트립(`.xls-row-num-strip__cell`)과 본문 행 높이는 반드시 동일해야 한다.
- 배경 격자(`.xls-content-data`의 `background-size`) 세로 간격은 행 높이 토큰과 동일해야 한다.

## 3) 뉴스 페이지 메타 영역 규칙

- 1~2행: 뉴스 영역 (44px)
- 3행: 텔레그램 `/news` 설명 (22px)
- 4~5행: 검색 영역 (44px)

즉, 메타 3개 행의 높이는 `44 / 22 / 44`를 사용한다.

## 3-1) 섹터 페이지 규칙

- 섹터 루트는 `sector-sheet`를 사용해 Excel Grid Contract를 상속한다.
- 탭 버튼은 최소 높이 `44px`(2행), 보더는 `1px` 그리드 선을 사용한다.
- 섹터 카드/리더 항목은 모서리 radius 없이 그리드 선으로 구획한다.
- 카드 내부 핵심 행은 `22px` 배수 높이를 사용한다.
- 섹터 페이지에서 개별 픽셀(20/23/24px) 하드코딩을 추가하지 않는다.

## 4) 변경 절차

1. 먼저 `web/src/styles/tokens.css`의 grid 토큰을 변경한다.
2. `excel-shell.css`가 토큰을 참조하는지 확인한다.
3. 개별 페이지에서 하드코딩 높이(22/23/20 등) 잔존 여부를 검색한다.
4. `pnpm --dir web build`로 레이아웃/타입 검증한다.

## 5) 금지 사항

- 특정 페이지만 예외로 23px, 21px 같은 임의 높이를 넣는 것
- 메타 행 높이를 인라인 스타일로 넣는 것
- 더미행 계산과 실제 CSS 행 높이를 다르게 두는 것
