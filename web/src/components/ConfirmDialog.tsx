import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import Button from './ui/Button'

/**
 * window.confirm 대신 쓰는 확인창. `if (!(await confirmDialog('지울까요?'))) return` 처럼 쓴다.
 * 네이티브 confirm은 iOS 홈 화면 앱에서 주소(도메인)가 제목으로 뜨고 글자가 작아 어색하다.
 * 화면에는 App에 한 번 둔 <ConfirmDialogHost />가 띄운다(호스트가 없으면 window.confirm으로 대체).
 */
export type ConfirmOptions = {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 지우기·끊기처럼 되돌리기 어려운 동작이면 확인 버튼을 빨갛게 */
  danger?: boolean
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

let show: ((p: Pending) => void) | null = null

export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options
  if (!show) return Promise.resolve(window.confirm(opts.message))
  return new Promise((resolve) => show?.({ ...opts, resolve }))
}

export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<Pending[]>([])
  const current = queue[0]
  // 확인 버튼 연타로 resolve가 두 번 불리지 않게
  const doneRef = useRef(false)

  useEffect(() => {
    show = (p) => setQueue((q) => [...q, p])
    return () => { show = null }
  }, [])

  useEffect(() => { doneRef.current = false }, [current])

  const finish = (ok: boolean) => {
    if (!current || doneRef.current) return
    doneRef.current = true
    current.resolve(ok)
    setQueue((q) => q.slice(1))
  }

  return (
    <Modal isOpen={!!current} title={current?.title ?? '확인'} onClose={() => finish(false)} size="sm">
      {current && (
        <>
          <p className="confirm-dialog__message">{current.message}</p>
          <div className="confirm-dialog__actions">
            <Button variant="ghost" onClick={() => finish(false)}>{current.cancelLabel ?? '취소'}</Button>
            <Button variant={current.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>
              {current.confirmLabel ?? '확인'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
