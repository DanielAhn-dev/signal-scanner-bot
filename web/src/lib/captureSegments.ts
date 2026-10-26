/**
 * 주문내역 캡처를 종목 한 건(이름 줄 + 상태 줄) 단위로 자르는 순수 함수들.
 * 한 장을 통째로 OCR하면 줄마다 다른 곳이 깨져서(2026-10-26 실측: 가격 누락·수량 오독),
 * 건별로 잘라 칸(이름·가격·상태)마다 따로 읽는다. 가격 칸은 숫자 전용으로 읽으면 11건 모두 정확했다.
 */

export type RowBlock = { top: number; bottom: number }

/**
 * RGBA → 글자가 어두운 회색조. 밝은 배경은 채널 최솟값(빨강·파랑 글자도 어둡게),
 * 어두운 화면(다크 모드)은 255-최댓값으로 뒤집는다.
 */
export function toInkGray(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4)
  let sum = 0
  for (let i = 0; i < n; i += 7) sum += (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3
  const dark = sum / Math.ceil(n / 7) < 110
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    out[i] = dark ? 255 - Math.max(r, g, b) : Math.min(r, g, b)
  }
  return out
}

const INK = 170

/**
 * 글자가 있는 가로 띠를 모아 건별 블록으로 묶는다. 같은 건의 이름 줄·상태 줄 사이 틈(글자 높이의 절반 안팎)은
 * 붙이고, 건 사이 틈(훨씬 큼)에서 끊는다. 기준은 화면 가로폭의 4%다(기기 해상도와 상관없이 비율이 같다).
 */
export function segmentBlocks(gray: Uint8Array, width: number, height: number): RowBlock[] {
  const minInk = Math.max(2, Math.round(width * 0.004))
  const bands: RowBlock[] = []
  let start = -1
  for (let y = 0; y < height; y++) {
    let ink = 0
    const row = y * width
    for (let x = 0; x < width; x++) if (gray[row + x] < INK) ink++
    const has = ink >= minInk
    if (has && start < 0) start = y
    if (!has && start >= 0) { bands.push({ top: start, bottom: y }); start = -1 }
  }
  if (start >= 0) bands.push({ top: start, bottom: height })
  if (bands.length === 0) return []

  const gap = width * 0.04
  const blocks: RowBlock[] = [{ ...bands[0] }]
  for (const b of bands.slice(1)) {
    const last = blocks[blocks.length - 1]
    if (b.top - last.bottom <= gap) last.bottom = b.bottom
    else blocks.push({ ...b })
  }
  return blocks
}

/** 이름 줄과 상태 줄이 함께 있는 건 블록인지(날짜 머리글·제목 같은 한 줄 블록과 구분) */
export function isItemBlock(b: RowBlock, width: number): boolean {
  return b.bottom - b.top >= width * 0.07
}

/** 글자 한 줄의 대략적인 높이 — 이름 줄·상태 줄 영역을 자를 때 쓴다 */
export const lineHeightOf = (width: number) => Math.round(width * 0.042)
