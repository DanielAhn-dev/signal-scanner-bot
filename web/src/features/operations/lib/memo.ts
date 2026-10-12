import { EVENT_LABEL_MAP, STRATEGY_LABEL_MAP } from '../constants'
import type { JobSnapshot, NoteTag } from '../types'

export function interpretMemo(memo: string | null): { label: string; reason: string | null } {
  if (!memo) return { label: '매매 근거 없음', reason: null }

  // key=value 형식 파싱
  if (memo.includes('strategy=') || memo.includes('event=')) {
    const map = new Map<string, string>()
    for (const token of memo.split(';')) {
      const eqIdx = token.indexOf('=')
      if (eqIdx < 0) continue
      const key = token.slice(0, eqIdx).trim().toLowerCase()
      const val = token.slice(eqIdx + 1).trim()
      if (key && val) map.set(key, val)
    }
    const strategyId = map.get('strategy') ?? map.get('strategy_id') ?? ''
    const event = map.get('event') ?? ''
    const note = map.get('note') ?? null

    const strategyLabel = STRATEGY_LABEL_MAP[strategyId] ?? strategyId
    const eventLabel = EVENT_LABEL_MAP[event] ?? event

    const label = strategyLabel && eventLabel
      ? `${strategyLabel} · ${eventLabel}`
      : eventLabel || strategyLabel || '매매'

    // note가 event와 동일하거나 중복이면 생략
    const rawNote = note && note !== event && note !== memo ? note : null
    // note에서 사람이 읽기 좋은 텍스트 추출
    const reason = rawNote
      ? (EVENT_LABEL_MAP[rawNote] ?? rawNote.replace(/-/g, ' '))
      : null

    return { label, reason }
  }

  // 레거시 메모
  if (memo.startsWith('autotrade-')) return { label: `자동매매 · ${memo.replace('autotrade-', '').replace(/-/g, ' ')}`, reason: null }
  if (memo.startsWith('watchlist-')) return { label: `관심종목 · ${memo.replace('watchlist-', '').replace(/-/g, ' ')}`, reason: null }
  return { label: memo, reason: null }
}

export function classifyDryRunNote(note: string): NoteTag {
  const normalized = String(note || '').toLowerCase()
  if (/후보|점수|진입|매수/i.test(note)) {
    return { key: 'candidate', label: '후보', color: '#0B57D0', bg: '#EBF3FF' }
  }
  if (/탈락|보류|스킵|없음|불가|제외/i.test(note)) {
    return { key: 'reject', label: '제외', color: '#92400E', bg: '#FFF4E5' }
  }
  if (/손절|익절|리스크|변동성|연속손실|오류|실패|timeout|fail/i.test(normalized)) {
    return { key: 'risk', label: '리스크', color: '#B42318', bg: '#FFF0F1' }
  }
  if (/전략|게이트|정책|비중|페이싱|프로필|기준/i.test(note)) {
    return { key: 'policy', label: '정책', color: '#4338CA', bg: '#EEF2FF' }
  }
  if (/실행|체결|매도|매수|반영/i.test(note)) {
    return { key: 'execution', label: '실행', color: '#0F766E', bg: '#E8F7F3' }
  }
  return { key: 'other', label: '기타', color: '#475467', bg: '#F5F7FA' }
}

export function resolveFailureCause(snapshot: JobSnapshot): string {
  const direct = String(snapshot.job.error || '').trim()
  if (direct) return translateOperationMessage(direct)

  const notes = snapshot.dry_run_details?.notes || []
  const noteHit = notes.find((note) => /오류|실패|error|fail|timeout/i.test(note))
  if (noteHit) return translateOperationMessage(noteHit)

  return '실패 원인 상세가 아직 수집되지 않았습니다.'
}

export function translateOperationMessage(message: string): string {
  const text = String(message || '').trim()
  if (!text) return '실패 원인 상세가 아직 수집되지 않았습니다.'

  const fifoLotMatch = text.match(/FIFO lots are insufficient for\s+([0-9A-Z]+):\s+need\s+(\d+),\s+left\s+(\d+)/i)
  if (fifoLotMatch) {
    const [, code, needRaw, leftRaw] = fifoLotMatch
    const need = Number(needRaw || 0)
    const left = Number(leftRaw || 0)
    return `${code} 매도 주문 수량이 현재 FIFO 기준 보유 수량보다 많아 실행하지 못했습니다. ${need}주를 매도하려 했지만 실제로 추적 가능한 잔량은 ${left}주입니다. 보유수량 조정, 이전 매도 반영 누락, 수동 수정 이력을 확인해 주세요.`
  }

  if (/timeout/i.test(text)) {
    return `작업 처리 시간이 초과되었습니다. 잠시 후 다시 시도하거나, 데이터/보유 상태를 먼저 점검해 주세요. 원문: ${text}`
  }

  if (/unsupported cron_dispatch task/i.test(text)) {
    return `지원하지 않는 작업 유형이라 실행할 수 없습니다. 운영패널 연결 작업명을 확인해 주세요.`
  }

  return text
}
