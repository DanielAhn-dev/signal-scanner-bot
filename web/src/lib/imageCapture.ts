import html2canvas from 'html2canvas'

function sanitizeFilename(name: string): string {
  return String(name || 'capture')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'capture'
}

export async function captureElementToPngBlob(
  element: HTMLElement,
  options?: {
    pixelRatio?: number
    width?: number
    height?: number
    backgroundColor?: string
  },
): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: options?.pixelRatio ?? 2,
    backgroundColor: options?.backgroundColor ?? '#ffffff',
    useCORS: true,
    allowTaint: true,
    width: options?.width,
    height: options?.height,
    onclone: (doc) => {
      doc.querySelectorAll('[data-capture-ignore="true"]').forEach((node) => {
        if (node instanceof HTMLElement) node.style.display = 'none'
      })
      
      // 동적 스타일(CSS 변수, 계산된 값 등)을 인라인 스타일로 강제 변환
      // 파이차트 배경 그래디언트가 제대로 캡처되도록 함
      doc.querySelectorAll('[style*="background"]').forEach((node) => {
        if (node instanceof HTMLElement) {
          const computedStyle = window.getComputedStyle(node)
          const bg = computedStyle.background || computedStyle.backgroundColor
          if (bg && !node.style.background) {
            node.style.background = bg
          }
        }
      })
      
      // .portfolio-allocation-chart 같은 배경 스타일 요소 특별 처리
      doc.querySelectorAll('.portfolio-allocation-chart, [class*="chart"]').forEach((node) => {
        if (node instanceof HTMLElement) {
          const computedStyle = window.getComputedStyle(node)
          const bg = computedStyle.background || computedStyle.backgroundColor
          if (bg) {
            node.style.background = bg
          }
        }
      })
    },
  })

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png', 1)
  })

  if (!blob) {
    throw new Error('이미지 생성에 실패했습니다.')
  }

  return blob
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(filename)}.png`
  a.click()
  URL.revokeObjectURL(url)
}

export async function shareBlobImage(params: {
  blob: Blob
  filename: string
  title: string
  text?: string
}): Promise<boolean> {
  if (!navigator.share || typeof File === 'undefined') return false

  const file = new File([params.blob], `${sanitizeFilename(params.filename)}.png`, { type: 'image/png' })
  const shareData: ShareData = {
    title: params.title,
    text: params.text || params.title,
    files: [file],
  }

  try {
    if (navigator.canShare && !navigator.canShare(shareData)) return false
    await navigator.share(shareData)
    return true
  } catch {
    return false
  }
}
