import { describe, expect, it } from 'vitest'
import { isItemBlock, segmentBlocks, toInkGray } from './captureSegments'

/** 흰 바탕에 지정한 가로 띠 [top, bottom)만 어두운 글자로 칠한 회색조 */
function stripes(width: number, height: number, ranges: Array<[number, number]>): Uint8Array {
  const g = new Uint8Array(width * height).fill(255)
  for (const [a, b] of ranges) for (let y = a; y < b; y++) for (let x = 10; x < 60; x++) g[y * width + x] = 20
  return g
}

describe('캡처 건별 자르기', () => {
  it('같은 건의 두 줄은 붙이고 건 사이 큰 틈에서 끊는다', () => {
    // 가로 100px → 기준 틈 4px. 건 안 틈 2px은 붙고, 건 사이 틈 14px은 끊긴다.
    const g = stripes(100, 120, [[10, 20], [22, 32], [46, 56], [58, 68], [90, 98]])
    const blocks = segmentBlocks(g, 100, 120)
    expect(blocks).toEqual([{ top: 10, bottom: 32 }, { top: 46, bottom: 68 }, { top: 90, bottom: 98 }])
  })

  it('두 줄짜리 건 블록과 한 줄짜리 머리글 블록을 구분한다', () => {
    expect(isItemBlock({ top: 10, bottom: 32 }, 100)).toBe(true)
    expect(isItemBlock({ top: 90, bottom: 96 }, 100)).toBe(false)
  })

  it('글자가 없으면 빈 목록', () => {
    expect(segmentBlocks(new Uint8Array(100 * 50).fill(255), 100, 50)).toEqual([])
  })

  it('색 글자는 어둡게, 다크 모드 화면은 뒤집어서 글자가 어두운 회색조로 만든다', () => {
    // 밝은 화면의 빨간 글자(229,82,74): 최솟값 74 → 어두움
    expect(toInkGray([255, 255, 255, 255, 229, 82, 74, 255])[1]).toBe(74)
    // 어두운 화면: 배경(20,20,20)은 밝게 235, 흰 글자는 0
    const dark = new Array(40 * 4).fill(20)
    dark[0] = dark[1] = dark[2] = 255
    const out = toInkGray(dark)
    expect(out[0]).toBe(0)
    expect(out[5]).toBe(235)
  })
})
