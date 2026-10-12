import { useEffect, useState, type RefObject } from 'react'

/**
 * 시트 표 아래 '빈 셀 줄' 개수 — 실제 내용 높이를 재서 화면에 남는 만큼만 채운다(내용이 화면보다 길면 0줄).
 * 빈 줄 행에는 data-filler 속성을 붙여야 내용 높이에서 빠진다.
 *
 * 기준은 화면에 고정된 바깥 영역(.xls-content-area)의 아래 끝이다. 시트 자신은 내용 높이에서 멈출 수 있어
 * 시트 높이로 재면 남는 높이가 0으로 나와 아래가 셀 없는 흰 바탕으로 남았다. 예전처럼 줄 수를 고정하거나
 * 창 높이로 어림하면 내용이 늘었을 때 빈 줄만큼 스크롤이 생긴다.
 */
export function useFillerRows(sheetRef: RefObject<HTMLElement | null>, maxRows = 80): number {
  const [fillerRows, setFillerRows] = useState(0)

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const area = sheet.closest<HTMLElement>('.xls-content-area') ?? sheet
    const update = () => {
      const table = sheet.querySelector('table')
      if (!table) return
      const fillers = sheet.querySelectorAll<HTMLTableRowElement>('tr[data-filler]')
      let fillerHeight = 0
      fillers.forEach((row) => { fillerHeight += row.offsetHeight })
      const rowHeight = fillers[0]?.offsetHeight || (window.innerWidth < 1024 ? 26 : 22)
      // 스크롤해 내려가 있으면 표 아래 끝이 위로 올라가 보이므로 시트~바깥 영역 사이 스크롤 양을 되돌린다
      let scrolled = 0
      for (let el: HTMLElement | null = sheet; el; el = el.parentElement) {
        scrolled += el.scrollTop
        if (el === area) break
      }
      const contentBottom = table.getBoundingClientRect().bottom + scrolled - fillerHeight
      const spare = area.getBoundingClientRect().bottom - contentBottom - 1
      const next = Math.max(0, Math.min(maxRows, Math.floor(spare / rowHeight)))
      setFillerRows((prev) => (prev === next ? prev : next))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(area)
    observer.observe(sheet)
    const table = sheet.querySelector('table')
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [sheetRef, maxRows])

  return fillerRows
}
