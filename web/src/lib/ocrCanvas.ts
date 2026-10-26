/**
 * 캡처 이미지를 OCR에 넣기 좋게 만드는 브라우저(캔버스) 도우미 — 주문내역·지출 내역 캡처가 함께 쓴다.
 * 글자가 어두운 회색조(captureSegments.toInkGray)로 바꾸고, 작은 화면은 키워서 넘긴다.
 */
import { toInkGray } from './captureSegments'

export type Gray = { data: Uint8Array; width: number; height: number }

export async function loadGray(file: File): Promise<Gray> {
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

/** 회색조의 한 영역을 잘라 확대한 캔버스로 — 글자가 작을수록 크게(가로 666px 기준 3배, 최대 4배) */
export function crop(g: Gray, x0: number, y0: number, x1: number, y1: number): HTMLCanvasElement {
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

/** Tesseract 작업자 — 필요한 부분만 타입을 좁혀 쓴다(라이브러리는 처음 읽을 때 동적으로 불러온다) */
export type OcrWorker = {
  setParameters: (p: Record<string, unknown>) => Promise<unknown>
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>
  terminate: () => Promise<unknown>
}
