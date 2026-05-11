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
