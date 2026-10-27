import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CommentaryCheckPage from './index'
import { COMMENTARY } from '../../lib/commentaryCheck'

describe('해설 점검 화면', () => {
  it('항목 8개를 JSON 숫자 그대로 보여 주고 생성일·스크립트를 붙인다', () => {
    render(<CommentaryCheckPage />)
    expect(screen.getByText('해설 점검')).toBeTruthy()
    for (const c of COMMENTARY.claims) {
      expect(screen.getByLabelText(c.short)).toBeTruthy()
      expect(screen.getAllByText(`${c.rateOnPct.toFixed(1)}%`).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(new RegExp(`생성일 ${COMMENTARY.generated}`))).toBeTruthy()
  })

  it('매매 지시 대신 "확인되지 않았다"로 말하고 한계를 접어서 보여 준다', () => {
    render(<CommentaryCheckPage />)
    expect(screen.getAllByText(/확인되지 않았어요|우연과 구분되지 않았어요|사례가 너무 적어요/).length).toBe(8)
    expect(screen.getByText('이 화면을 읽는 법')).toBeTruthy()
    expect(document.body.textContent).toContain('틀렸다')
    expect(document.body.textContent).not.toMatch(/사세요|파세요|매수하세요|매도하세요/)
  })
})
