import React, { useRef, useCallback } from 'react'

export type ColDef = {
  key: string
  label: string          // 열 헤더 텍스트 (예: "종목명", "현재가")
  letter?: string        // A, B, C... 자동 설정됨
  width?: number         // px
  minWidth?: number
  align?: 'left' | 'right' | 'center'
  numeric?: boolean      // tabular-nums 적용
}

export type CellStyle = {
  color?: string
  background?: string
  fontWeight?: string
  fontStyle?: string
}

export type RowData = {
  [key: string]: React.ReactNode
  _key?: string           // 고유 row key
  _style?: Record<string, CellStyle> // 셀별 스타일 { colKey: style }
  _rowStyle?: CellStyle   // 행 전체 스타일
}

type Props = {
  columns: ColDef[]
  rows: RowData[]
  /** 선택된 셀 표시 */
  selectedCell?: { row: number; col: string } | null
  onCellClick?: (row: number, col: string, value: React.ReactNode) => void
  /** 고정 행 (헤더 바로 아래 frozen row) */
  frozenRows?: number
  /** 빈 셀 최소 행 수 (엑셀처럼 아래 빈 행 채우기) */
  minRows?: number
  /** 컬럼 문자 표시 여부 (A,B,C...) */
  showLetters?: boolean
  /** 행 번호 표시 여부 */
  showRowNumbers?: boolean
  className?: string
  style?: React.CSSProperties
}

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function getColLetter(index: number): string {
  if (index < 26) return COL_LETTERS[index]
  return COL_LETTERS[Math.floor(index / 26) - 1] + COL_LETTERS[index % 26]
}

export default function ExcelSpreadsheet({
  columns,
  rows,
  selectedCell,
  onCellClick,
  frozenRows = 0,
  minRows = 30,
  showLetters = true,
  showRowNumbers = true,
  className = '',
  style,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const cols = columns.map((c, i) => ({
    ...c,
    letter: c.letter ?? getColLetter(i),
    width: c.width ?? (c.numeric ? 90 : 120),
    minWidth: c.minWidth ?? (c.numeric ? 70 : 80),
    align: c.align ?? (c.numeric ? 'right' : 'left'),
  }))

  // 빈 행으로 채우기
  const paddedRows: RowData[] = [
    ...rows,
    ...Array.from({ length: Math.max(0, minRows - rows.length) }, (_, i) => ({
      _key: `__empty_${i}`,
    })),
  ]

  const handleCellClick = useCallback((rowIdx: number, colKey: string, value: React.ReactNode) => {
    onCellClick?.(rowIdx, colKey, value)
  }, [onCellClick])

  const ROW_NUM_WIDTH = showRowNumbers ? 32 : 0

  return (
    <div
      ref={wrapRef}
      className={`xls-wrap ${className}`}
      style={style}
    >
      <table className="xls-table">
        <colgroup>
          {showRowNumbers && <col style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }} />}
          {cols.map(c => (
            <col key={c.key} style={{ width: c.width, minWidth: c.minWidth }} />
          ))}
        </colgroup>

        <thead>
          {/* 열 문자 행 (A, B, C...) */}
          {showLetters && (
            <tr className="xls-letter-row">
              {showRowNumbers && <th className="xls-corner" />}
              {cols.map(c => (
                <th key={c.key} className="xls-col-letter">
                  {c.letter}
                </th>
              ))}
            </tr>
          )}

          {/* 열 레이블 행 (종목명, 현재가...) */}
          <tr className="xls-header-row">
            {showRowNumbers && <th className="xls-row-num-header" />}
            {cols.map(c => (
              <th
                key={c.key}
                className="xls-th"
                style={{ textAlign: c.align }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {paddedRows.map((row, rowIdx) => {
            const isEven = rowIdx % 2 === 0
            const isFrozen = rowIdx < frozenRows
            const rowKey = row._key ?? rowIdx.toString()

            return (
              <tr
                key={rowKey}
                className={[
                  'xls-row',
                  isEven ? 'xls-row--even' : '',
                  isFrozen ? 'xls-row--frozen' : '',
                ].join(' ')}
                style={row._rowStyle ? {
                  color: row._rowStyle.color,
                  background: row._rowStyle.background,
                  fontWeight: row._rowStyle.fontWeight,
                } : undefined}
              >
                {showRowNumbers && (
                  <td className="xls-row-num">{rowIdx + 1}</td>
                )}
                {cols.map(c => {
                  const cellVal = row[c.key]
                  const cellStyle = row._style?.[c.key]
                  const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === c.key

                  return (
                    <td
                      key={c.key}
                      className={[
                        'xls-cell',
                        c.numeric ? 'xls-cell--num' : '',
                        isSelected ? 'xls-cell--selected' : '',
                        cellVal == null ? 'xls-cell--empty' : '',
                      ].join(' ')}
                      style={{
                        textAlign: c.align,
                        ...(cellStyle ? {
                          color: cellStyle.color,
                          background: cellStyle.background,
                          fontWeight: cellStyle.fontWeight,
                          fontStyle: cellStyle.fontStyle,
                        } : {}),
                      }}
                      onClick={() => handleCellClick(rowIdx, c.key, cellVal)}
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') handleCellClick(rowIdx, c.key, cellVal)
                      }}
                    >
                      {cellVal ?? ''}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
