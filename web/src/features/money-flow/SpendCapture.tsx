import { useRef, useState } from 'react'
import { parseSpendCapture } from '../../lib/spendCapture'
import { ocrSpendCapture } from './spendOcr'

/**
 * 지출 기록의 "캡처로 불러오기" — 카드·뱅킹 앱의 거래내역 캡처를 읽어 빠른 기록 입력칸을 채운다.
 * 채운 뒤에는 지금 흐름 그대로(읽기 → 분류 → 확인 → 저장)라서 새 저장 경로가 없고, 글자는 입력칸에서 고칠 수 있다.
 */
export default function SpendCapture({ today, existing, onRead }: {
  today: string
  /** 이미 기록된 지출(같은 날·같은 금액이면 중복으로 뺀다) */
  existing: Array<{ date: string; amount: number }>
  /** 읽은 줄(빠른 기록 형식)과 안내 문구 */
  onRead: (text: string, notice: string) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const busyRef = useRef(false)

  const read = async () => {
    if (busyRef.current || files.length === 0) return
    busyRef.current = true
    setStatus('준비 중…')
    try {
      const text = await ocrSpendCapture(files, setStatus)
      const r = parseSpendCapture(text, today, existing)
      const extras = [
        r.duplicates > 0 ? `이미 있는 ${r.duplicates}건` : '',
        r.income > 0 ? `입금 ${r.income}건` : '',
      ].filter(Boolean)
      const lost = r.unread > 0 ? ` 금액을 못 읽은 ${r.unread}줄은 직접 적어 주세요.` : ''
      onRead(
        r.lines.join('\n'),
        r.lines.length === 0
          ? `읽은 지출이 없습니다. 거래내역 목록이 글자가 선명하게 나오게 다시 캡처해 주세요.${lost}`
          : `${r.lines.length}줄을 읽었습니다${extras.length ? ` (${extras.join('·')}은 뺐어요)` : ''}. 이름·금액을 대조하고 아래 "읽기"로 확인하세요.${lost}`,
      )
    } catch (error) {
      onRead('', `캡처를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busyRef.current = false
      setStatus(null)
    }
  }

  return (
    <div className="acc-field mf-capture">
      <span>캡처로 불러오기 (선택)</span>
      <small className="acc-note">카드·뱅킹 앱의 거래내역 화면을 캡처해 올리면 입력칸을 채웁니다. 글자 인식은 이 기기 안에서 하고 이미지는 서버로 보내지 않습니다.</small>
      <div className="mf-row">
        <input type="file" accept="image/*" multiple aria-label="거래내역 캡처 고르기" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        <button type="button" className="acc-secondary" onClick={() => void read()} disabled={files.length === 0 || status != null}>
          {status ?? '캡처 읽기'}
        </button>
      </div>
    </div>
  )
}
