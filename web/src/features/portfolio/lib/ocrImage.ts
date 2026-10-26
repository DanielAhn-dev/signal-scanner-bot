/**
 * 주문내역 캡처를 브라우저 안에서 읽는다(Tesseract.js, 무료·이미지를 서버로 보내지 않음).
 * 라이브러리와 한글 학습 데이터(수 MB)는 처음 읽을 때만 내려받으므로 동적 import로 번들에서 뺀다.
 *
 * 한 장을 통째로 읽으면 줄마다 다른 곳이 깨져서, 건별로 자른 뒤 칸마다 따로 읽는다:
 *   이름 줄(왼쪽 위) → 일반 읽기 / 가격(오른쪽) → 숫자 전용 / 상태 줄(왼쪽 아래) → 구매·판매·완료·취소 글자 전용
 * 날짜 머리글 같은 한 줄 블록은 그대로 읽는다. 칸별 결과를 합치는 일은 lib/tradeCapture의 assembleCaptureText.
 */
import { isItemBlock, lineHeightOf, segmentBlocks, toInkGray, type RowBlock } from '../../../lib/captureSegments'
import type { BlockRead } from '../../../lib/tradeCapture'

type Gray = { data: Uint8Array; width: number; height: number }

async function loadGray(file: File): Promise<Gray> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('이미지를 처리할 수 없습니다')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: toInkGray(data), width: canvas.width, height: canvas.height }
}

/** 회색조의 한 영역을 잘라 확대한 캔버스로 — 글자가 작을수록 크게(가로 666px 기준 3배) */
function crop(g: Gray, x0: number, y0: number, x1: number, y1: number): HTMLCanvasElement {
  const left = Math.max(0, Math.round(x0))
  const top = Math.max(0, Math.round(y0))
  const w = Math.max(1, Math.min(g.width, Math.round(x1)) - left)
  const h = Math.max(1, Math.min(g.height, Math.round(y1)) - top)
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sctx = src.getContext('2d')
  if (!sctx) throw new Error('이미지를 처리할 수 없습니다')
  const img = sctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g.data[(top + y) * g.width + left + x]
      const o = (y * w + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  }
  sctx.putImageData(img, 0, 0)
  const scale = Math.min(4, Math.max(1, Math.round(1800 / g.width)))
  const dst = document.createElement('canvas')
  dst.width = w * scale
  dst.height = h * scale
  const dctx = dst.getContext('2d')
  if (!dctx) throw new Error('이미지를 처리할 수 없습니다')
  dctx.imageSmoothingQuality = 'high'
  dctx.drawImage(src, 0, 0, dst.width, dst.height)
  return dst
}

type Worker = {
  setParameters: (p: Record<string, unknown>) => Promise<unknown>
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>
  terminate: () => Promise<unknown>
}

export async function ocrCapture(files: File[], onStatus: (message: string) => void): Promise<BlockRead[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  onStatus('글자 인식 준비 중… (처음에는 한글 데이터를 내려받아 조금 걸립니다)')
  const worker = (await createWorker('kor+eng', 1)) as unknown as Worker
  const read = async (c: HTMLCanvasElement) => (await worker.recognize(c)).data.text
  const out: BlockRead[] = []
  try {
    for (let f = 0; f < files.length; f++) {
      const prefix = files.length > 1 ? `${f + 1}/${files.length}번째 캡처 · ` : ''
      onStatus(`${prefix}화면을 건별로 나누는 중…`)
      const g = await loadGray(files[f])
      const blocks = segmentBlocks(g.data, g.width, g.height).filter((b) => b.bottom - b.top >= 6)
      const lineH = lineHeightOf(g.width)
      const items = blocks.filter((b) => isItemBlock(b, g.width))
      const read1 = new Map<RowBlock, { name: string; price: string; status: string; full: string }>()
      for (const b of items) read1.set(b, { name: '', price: '', status: '', full: '' })

      // 1) 한 줄 블록(날짜 머리글·제목) — 블록 전체를 한 덩어리로 읽는다
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' })
      const shortText = new Map<RowBlock, string>()
      let n = 0
      for (const b of blocks) {
        if (read1.has(b)) continue
        onStatus(`${prefix}머리글 읽는 중… ${++n}`)
        shortText.set(b, await read(crop(g, 0, b.top - 6, g.width, b.bottom + 6)))
      }
      // 2) 이름 줄
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' })
      n = 0
      for (const b of items) {
        onStatus(`${prefix}종목명 읽는 중… ${++n}/${items.length}`)
        read1.get(b)!.name = (await read(crop(g, 0, b.top - 4, g.width * 0.7, b.top + lineH + 6))).trim()
      }
      // 3) 가격 — 숫자 전용
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789,.원주당 ' })
      n = 0
      for (const b of items) {
        onStatus(`${prefix}체결가 읽는 중… ${++n}/${items.length}`)
        read1.get(b)!.price = (await read(crop(g, g.width * 0.58, b.top - 8, g.width, b.bottom + 8))).trim()
      }
      // 4) 상태 줄 — 수량·구매/판매·완료/취소 글자 전용
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789,주구매판완료취소미체결접수 ' })
      n = 0
      for (const b of items) {
        onStatus(`${prefix}체결 상태 읽는 중… ${++n}/${items.length}`)
        const top = Math.max(b.top, b.bottom - lineH - 6)
        read1.get(b)!.status = (await read(crop(g, 0, top - 4, g.width * 0.6, b.bottom + 8))).trim()
      }
      // 5) 보조 — 칸별 읽기가 비는 건만 블록 전체를 한 번 더 읽는다
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' })
      for (const b of items) {
        const r = read1.get(b)!
        const okStatus = /주\s*(구매|구입|매수|판매|매도)/u.test(r.status)
        const okPrice = /\d{3,}/.test(r.price)
        if (okStatus && okPrice && r.name) continue
        r.full = await read(crop(g, 0, b.top - 6, g.width, b.bottom + 6))
      }
      // 화면 위에서 아래 순서 그대로 합친다
      for (const b of blocks) {
        const r = read1.get(b)
        if (r) out.push({ kind: 'item', ...r })
        else out.push({ kind: 'text', text: shortText.get(b) ?? '' })
      }
    }
    return out
  } finally {
    await worker.terminate()
  }
}
