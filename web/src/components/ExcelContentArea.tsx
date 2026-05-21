/**
 * ExcelContentArea
 *
 * 모든 페이지의 콘텐츠 영역을 감싸는 스프레드시트 그리드 컨테이너.
 * - 항상 열 문자(A, B, C...) + 행 번호(1, 2, 3...) 가 보임
 * - 페이지 콘텐츠는 그 격자 안에 셀로 표현
 * - ExcelSpreadsheet를 사용하는 페이지: 그리드에 완전 통합
 * - 미변환 페이지: grid-compat 래퍼로 격자 안에 녹아들게 처리
 */
import React from 'react'

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const NUM_COLS = 26  // A-Z

type Props = {
  children: React.ReactNode
  /** 행 번호 노출 여부 */
  showRowNums?: boolean
  /** 열 문자 노출 여부 */
  showColLetters?: boolean
  /** ExcelSpreadsheet를 직접 사용하는 페이지면 true (래퍼 최소화) */
  isNativeGrid?: boolean
}

export default function ExcelContentArea({
  children,
  showRowNums = true,
  showColLetters = true,
  isNativeGrid = false,
}: Props) {
  if (isNativeGrid) {
    // ExcelSpreadsheet / ExcelLayout 이 직접 그리드를 그리는 경우
    return <div className="xls-content-area xls-content-area--native">{children}</div>
  }

  return (
    <div className="xls-content-area">
      {/* 열 문자 헤더 행 */}
      {showColLetters && (
        <div className="xls-col-header-strip">
          {showRowNums && <div className="xls-col-header-strip__corner" />}
          {Array.from({ length: NUM_COLS }, (_, i) => (
            <div key={i} className="xls-col-header-strip__cell">
              {COL_LETTERS[i]}
            </div>
          ))}
        </div>
      )}

      <div className="xls-content-body">
        {/* 행 번호 컬럼 */}
        {showRowNums && (
          <div className="xls-row-num-strip" aria-hidden>
            {Array.from({ length: 200 }, (_, i) => (
              <div key={i} className="xls-row-num-strip__cell">{i + 1}</div>
            ))}
          </div>
        )}

        {/* 실제 콘텐츠 — 그리드 격자 배경 위에 표시 */}
        <div className="xls-content-data">
          <div className="xls-grid-bg" aria-hidden />
          <div className="xls-content-inner">{children}</div>
        </div>
      </div>
    </div>
  )
}
