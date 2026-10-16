import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  /** 칸 안 오른쪽에 붙는 단위 (예: %, 만원) */
  unit: string
  /** 칸 전체 너비 — 단위 자리 포함 */
  width?: number | string
}

/** 숫자 + 단위 입력칸 — 단위를 칸 밖에 따로 쓰면 다음 항목 이름과 붙어 보여서 칸 안 오른쪽에 둔다 */
export default function UnitInput({ unit, width = 96, className = '', style, ...rest }: Props) {
  return (
    <span className={`ui-unit-input ${className}`} style={{ width, ...style }}>
      <input className="ui-unit-input__field" autoComplete="off" {...rest} />
      <span className="ui-unit-input__unit" aria-hidden="true">{unit}</span>
    </span>
  )
}
