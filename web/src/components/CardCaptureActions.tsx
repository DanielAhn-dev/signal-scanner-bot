import React, { useState } from 'react'
import { captureElementToPngBlob, downloadBlob, shareBlobImage } from '../lib/imageCapture'

type Props = {
  targetId: string
  title: string
  filename: string
  text?: string
  className?: string
  hideShare?: boolean
  captureOptions?: {
    pixelRatio?: number
    width?: number
    height?: number
    backgroundColor?: string
  }
  onNotify?: (message: string) => void
}

export default function CardCaptureActions({
  targetId,
  title,
  filename,
  text,
  className = '',
  hideShare = false,
  captureOptions,
  onNotify,
}: Props) {
  const [busy, setBusy] = useState(false)

  const notify = (message: string) => {
    if (onNotify) onNotify(message)
  }

  const getTarget = (): HTMLElement | null => {
    const el = document.getElementById(targetId)
    return el instanceof HTMLElement ? el : null
  }

  const capture = async (): Promise<Blob | null> => {
    const target = getTarget()
    if (!target) {
      notify('캡처할 카드 영역을 찾지 못했습니다')
      return null
    }

    setBusy(true)
    try {
      const blob = await captureElementToPngBlob(target, captureOptions)
      return blob
    } catch (e: any) {
      notify(String(e?.message || e || '이미지 생성 실패'))
      return null
    } finally {
      setBusy(false)
    }
  }

  const onSave = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const blob = await capture()
    if (!blob) return
    downloadBlob(blob, filename)
    notify('카드 이미지를 저장했습니다')
  }

  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const blob = await capture()
    if (!blob) return

    const shared = await shareBlobImage({
      blob,
      filename,
      title,
      text: text || title,
    })

    if (shared) {
      notify('공유 앱을 열었습니다. 카카오톡을 선택해 보내세요.')
      return
    }

    downloadBlob(blob, filename)
    notify('기기 공유를 지원하지 않아 이미지로 저장했습니다')
  }

  return (
    <div className={`card-capture-actions ${className}`.trim()} data-capture-ignore="true">
      <button
        type="button"
        className="card-capture-btn"
        onClick={onSave}
        disabled={busy}
      >
        {busy ? '생성 중...' : '저장'}
      </button>
      {!hideShare && (
        <button
          type="button"
          className="card-capture-btn card-capture-btn-share"
          onClick={onShare}
          disabled={busy}
        >
          공유
        </button>
      )}
    </div>
  )
}
