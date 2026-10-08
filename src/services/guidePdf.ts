/**
 * 안내 PDF(docs/generated/*.pdf)를 공개 저장소에서 받아 온다.
 *
 * 예전에는 process.cwd() 경로로 읽어서 ui·worker 함수마다 PDF 7.6MB가 통째로 묶였다(Vercel 함수 저장 용량,
 * 2026-10-08 무료 한도 75% 경고). 저장소가 공개이고 PDF는 docs-guide-pdf-check 워크플로가 main에서 최신인지 확인하므로
 * main의 raw 파일을 그때그때 받는다. 다른 곳에 두려면 GUIDE_PDF_BASE_URL로 바꾼다.
 */
export type GuidePdfName = 'user-operating-guide.pdf' | 'automate-trade-command-guide.pdf'

const DEFAULT_BASE = 'https://raw.githubusercontent.com/DanielAhn-dev/signal-scanner-bot/main/docs/generated'

export function guidePdfUrl(name: GuidePdfName): string {
  const base = (process.env.GUIDE_PDF_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/${name}`
}

export async function fetchGuidePdf(name: GuidePdfName, timeoutMs = 15_000): Promise<Buffer<ArrayBuffer>> {
  const res = await fetch(guidePdfUrl(name), { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`가이드 PDF를 받지 못했습니다(HTTP ${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // %PDF 머리글 확인 — 오류 페이지를 PDF로 보내지 않게
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    throw new Error('받은 파일이 PDF가 아닙니다')
  }
  return bytes
}
