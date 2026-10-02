import Detail from '../../components/ui/Detail'
import React, { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'
import { apiFetch } from '../../lib/api'
import { formatKrwCompact } from '../../lib/format'
import TelegramLinkCallout from '../../components/TelegramLinkCallout'
import { requestOpenProfileModal } from '../../lib/profileModal'
import { useCurrentChatId, useIsTelegramLinked } from '../../stores/profileStore'
import { recordSwitch } from '../../lib/switchHistory'

/** 종목 매매 봇을 권하지 않는 시드 기준 — 2026-09-29 시드 크기 검증: 100만 -9.3%p, 300만 -1.9%p, 1천만 이상 차이 0.2%p 이내 */
const SMALL_SEED_LIMIT = 10_000_000

type DepositInfo = {
  monthly_deposit: number
  deposit_day: number
  next_deposit_date: string | null
  total_deposited: number | null
  deposit_log: Array<{ date: string; amount: number; cashAfter: number }>
}

export default function Settings(){
  const currentChatId = useCurrentChatId()
  // 텔레그램은 선택 — 미연결이면 currentChatId는 웹 전용 계정 ID다
  const telegramLinked = useIsTelegramLinked()
  const [chatId, setChatId] = useState<string>('')
  const [message, setMessage] = useState<string>('테스트 알림입니다.')
  const [status, setStatus] = useState<string|undefined>()
  const [loading, setLoading] = useState(false)

  const [settings, setSettings] = useState<any | null>(null)
  const [seedCapital, setSeedCapital] = useState<string>('')
  const [virtualCash, setVirtualCash] = useState<number | null>(null)
  const [seedCapitalStatus, setSeedCapitalStatus] = useState<string | undefined>()
  const [savingSeed, setSavingSeed] = useState(false)
  const [strategyMode, setStrategyMode] = useState<'stock' | 'index_hold' | null>(null)
  const [deposit, setDeposit] = useState<DepositInfo | null>(null)
  const [depositMan, setDepositMan] = useState<string>('')
  const [depositDay, setDepositDay] = useState<string>('')
  const [savingDeposit, setSavingDeposit] = useState(false)
  const [depositStatus, setDepositStatus] = useState<string | undefined>()
  const [notifyChannel, setNotifyChannel] = useState<'telegram' | 'push' | null>(null)
  const [savingChannel, setSavingChannel] = useState(false)
  const [channelStatus, setChannelStatus] = useState<string | undefined>()
  const [savingMode, setSavingMode] = useState(false)
  const [modeStatus, setModeStatus] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [resettingAutoOnly, setResettingAutoOnly] = useState(false)
  const [runningDryRun, setRunningDryRun] = useState(false)
  const [runningLiveRun, setRunningLiveRun] = useState(false)
  const [accessInfo, setAccessInfo] = useState<{ chat_id: number | null; is_admin: boolean; has_advanced_access: boolean } | null>(null)
  const [accessRows, setAccessRows] = useState<Array<{ chat_id: number; nickname?: string | null; note?: string | null; is_enabled?: boolean | null; updated_at?: string | null }>>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminTargetChatId, setAdminTargetChatId] = useState('')
  const [adminNickname, setAdminNickname] = useState('')
  const [adminNote, setAdminNote] = useState('')

  useEffect(() => {
    setChatId((prev) => (prev === currentChatId ? prev : currentChatId))
  }, [currentChatId])

  useEffect(() => {
    (async () => {
      try {
        const json = await apiFetch('/api/ui/settings', { cacheMs: 0, timeoutMs: 10_000 })
        setSettings(json?.data ?? null)
      } catch (e) {
        // ignore
      }

      try {
        const json = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, timeoutMs: 10_000 })
        const seed = json?.data?.virtual_seed_capital
        if (seed != null) setSeedCapital(String(Math.round(seed)))
        const cash = json?.data?.virtual_cash
        if (cash != null) setVirtualCash(cash)
        setStrategyMode(json?.data?.strategy_mode === 'index_hold' ? 'index_hold' : 'stock')
        applyDepositInfo(json?.data)
        setNotifyChannel(json?.data?.notify_channel === 'push' ? 'push' : 'telegram')
      } catch (e) {
        // ignore
      }

      try {
        const me = await apiFetch('/api/ui/access-users?mode=me', { cacheMs: 0, timeoutMs: 10_000 })
        const info = me?.data ?? null
        setAccessInfo(info)
        if (info?.is_admin) {
          const list = await apiFetch('/api/ui/access-users', { cacheMs: 0, timeoutMs: 10_000 })
          setAccessRows(Array.isArray(list?.data) ? list.data : [])
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  const refreshAccessRows = async () => {
    if (!accessInfo?.is_admin) return
    const list = await apiFetch('/api/ui/access-users', { cacheMs: 0, timeoutMs: 10_000 })
    setAccessRows(Array.isArray(list?.data) ? list.data : [])
  }

  const upsertAccessUser = async () => {
    const normalized = String(adminTargetChatId || '').trim().replace(/[^0-9]/g, '')
    if (!normalized) {
      setStatus('관리 대상 Chat ID를 입력해 주세요.')
      return
    }
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({
          chat_id: Number(normalized),
          nickname: adminNickname.trim() || undefined,
          note: adminNote.trim() || undefined,
          is_enabled: true,
        }),
      })
      setStatus('고급 기능 사용자 저장 완료')
      setAdminTargetChatId('')
      setAdminNickname('')
      setAdminNote('')
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const toggleAccessUser = async (targetChatId: number, nextEnabled: boolean) => {
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'PATCH',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: targetChatId, is_enabled: nextEnabled }),
      })
      setStatus(`고급 기능 ${nextEnabled ? '허용' : '차단'} 완료`)
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const removeAccessUser = async (targetChatId: number) => {
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: targetChatId }),
      })
      setStatus('고급 기능 사용자 삭제 완료')
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const sendTest = async () => {
    setStatus(undefined)
    setLoading(true)
    try {
      const json = await apiFetch('/api/ui/notify', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: chatId || undefined, message })
      })
      if (json?.error) setStatus(String(json?.error || '전송 실패'))
      else setStatus('전송 성공')
    } catch (e: any) {
      setStatus(String(e))
    } finally {
      setLoading(false)
    }
  }

  const applyDepositInfo = (data: any) => {
    if (!data || data.monthly_deposit === undefined) return
    const info: DepositInfo = {
      monthly_deposit: Number(data.monthly_deposit) || 0,
      deposit_day: Number(data.deposit_day) || 1,
      next_deposit_date: data.next_deposit_date ?? null,
      total_deposited: data.total_deposited ?? null,
      deposit_log: Array.isArray(data.deposit_log) ? data.deposit_log : [],
    }
    setDeposit(info)
    setDepositMan(info.monthly_deposit > 0 ? String(info.monthly_deposit / 10_000) : '0')
    setDepositDay(String(info.deposit_day))
  }

  const saveNotifyChannel = async (next: 'telegram' | 'push') => {
    if (next === notifyChannel) return
    setSavingChannel(true)
    setChannelStatus(undefined)
    try {
      const json = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ notify_channel: next }),
      })
      setNotifyChannel(json?.data?.notify_channel === 'push' ? 'push' : 'telegram')
      setChannelStatus(next === 'push' ? '저장 완료 — 이제 알림은 브라우저 푸시로만 옵니다' : '저장 완료 — 이제 알림은 텔레그램으로만 옵니다')
    } catch (e: any) {
      setChannelStatus(String(e?.message || e))
    } finally {
      setSavingChannel(false)
    }
  }

  const saveDeposit = async () => {
    const man = Number(depositMan.replace(/,/g, '').trim())
    const day = Number(depositDay.trim())
    if (!Number.isFinite(man) || man < 0 || (man > 0 && man < 1)) {
      setDepositStatus('월 입금액은 0(적립 안 함) 또는 1만원 이상으로 입력하세요')
      return
    }
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setDepositStatus('입금일은 1~28일 중에서 고르세요')
      return
    }
    setSavingDeposit(true)
    setDepositStatus(undefined)
    try {
      const json = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ monthly_deposit: Math.round(man * 10_000), deposit_day: day }),
      })
      applyDepositInfo(json?.data)
      setDepositStatus(man > 0 ? '저장 완료' : '저장 완료 — 월 적립을 하지 않습니다')
    } catch (e: any) {
      setDepositStatus(String(e?.message || e))
    } finally {
      setSavingDeposit(false)
    }
  }

  const saveSeedCapital = async (resetCash = false) => {
    const parsed = Number(seedCapital.replace(/,/g, '').trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSeedCapitalStatus('1원 이상의 금액을 입력해 주세요')
      return
    }
    setSavingSeed(true)
    setSeedCapitalStatus(undefined)
    try {
      const result = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ virtual_seed_capital: Math.round(parsed), reset_cash: resetCash }),
      })
      const updatedCash = result?.data?.virtual_cash
      if (updatedCash != null) setVirtualCash(updatedCash)
      setSeedCapitalStatus(resetCash ? '저장 및 잔여 현금 초기화 완료' : '저장 완료')
    } catch (e: any) {
      setSeedCapitalStatus(String(e?.message || e))
    } finally {
      setSavingSeed(false)
    }
  }

  const saveStrategyMode = async (next: 'stock' | 'index_hold') => {
    if (next === strategyMode) return
    const confirmed = window.confirm(
      next === 'index_hold'
        ? [
            '지수 보유 모드로 바꿉니다.',
            '다음 자동매매 실행 때 종목 봇이 산 보유 종목을 모두 팔고 KODEX 200으로 옮깁니다. 이후 새로 들어온 돈도 KODEX 200을 삽니다.',
            '계속할까요?',
          ].join(String.fromCharCode(10))
        : [
            '종목 매매 봇으로 되돌립니다.',
            '다음 실행 때 KODEX 200은 유휴현금으로 넘겨 종목 봇이 이어서 씁니다.',
            '계속할까요?',
          ].join(String.fromCharCode(10))
    )
    if (!confirmed) return
    setSavingMode(true)
    setModeStatus(undefined)
    try {
      // 바꾸기 직전 보유를 남겨 둔다 — 나중에 "안 바꿨다면"과 비교하는 출발점 (내 선택 돌아보기)
      await recordSwitch(strategyMode ?? 'stock', next)
      const json = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ strategy_mode: next }),
      })
      setStrategyMode(json?.data?.strategy_mode === 'index_hold' ? 'index_hold' : 'stock')
      setModeStatus('저장 완료 — 다음 자동매매 실행부터 적용됩니다')
    } catch (e: any) {
      setModeStatus(`저장 실패: ${String(e?.message || e)}`)
    } finally {
      setSavingMode(false)
    }
  }

  const saveSettings = async (): Promise<boolean> => {
    setSaving(true)
    try {
      const payload = {
        chat_id: chatId || undefined,
        is_enabled: !!settings?.is_enabled,
        monday_buy_slots: Number(settings?.monday_buy_slots || 2),
        max_positions: Number(settings?.max_positions || 10),
        min_buy_score: Number(settings?.min_buy_score || 72),
        take_profit_pct: Number(settings?.take_profit_pct || 8),
        stop_loss_pct: Number(settings?.stop_loss_pct || 4),
        long_term_ratio: Number(settings?.long_term_ratio ?? 70),
      }
      const json = await apiFetch('/api/ui/settings', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify(payload)
      })
      if (json?.error) {
        setStatus(String(json?.error || '저장 실패'))
        return false
      }
      else {
        setStatus('저장 성공')
        setSettings(json.data)
        return true
      }
    } catch (e: any) {
      setStatus(String(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  const resetAutoTradeOnly = async () => {
    const confirmed = window.confirm(
      ['자동매매로 생성된 이력/로그만 초기화합니다.', '직접 추가한 수동 보유/거래는 유지됩니다.', '계속할까요?'].join(String.fromCharCode(10))
    )
    if (!confirmed) return

    const secondConfirm = window.confirm('정말 실행할까요? 이 작업은 되돌릴 수 없습니다.')
    if (!secondConfirm) return

    setResettingAutoOnly(true)
    setStatus(undefined)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({ mode: 'reset_autotrade_auto_only' }),
      })

      if (json?.error) throw new Error(String(json.error))

      const data = json?.data || {}
      const autoTrades = Number(data.auto_trade_count || 0)
      const autoPositions = Number(data.auto_position_count || 0)
      const autoLots = Number(data.auto_lot_count || 0)
      setStatus(
        `자동매매 초기화 완료 (AUTO 거래 ${autoTrades}건, AUTO 포지션 ${autoPositions}건, AUTO lot ${autoLots}건 정리)`
      )
    } catch (e: any) {
      setStatus(`자동매매 초기화 실패: ${String(e?.message || e)}`)
    } finally {
      setResettingAutoOnly(false)
    }
  }

  const runAutoCycleOnce = async (dryRun: boolean, saveFirst = true) => {
    if (saveFirst) {
      const ok = await saveSettings()
      if (!ok) return
    }

    if (dryRun) setRunningDryRun(true)
    else setRunningLiveRun(true)

    setStatus(undefined)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 90_000,
        body: JSON.stringify({ mode: 'autocycle', dry_run: dryRun }),
      })

      if (json?.error) throw new Error(String(json.error))

      const jobId = String(json?.job_id || '').trim()
      const runLabel = dryRun ? '점검 1회' : '실행 1회'
      if (json?.execution_error) {
        setStatus(`자동매매 ${runLabel} 실패: ${String(json.execution_error)}`)
      } else {
        setStatus(`자동매매 ${runLabel} 요청 완료${jobId ? ` (job_id: ${jobId})` : ''}`)
      }
    } catch (e: any) {
      setStatus(`자동매매 ${dryRun ? '점검' : '실행'} 실패: ${String(e?.message || e)}`)
    } finally {
      if (dryRun) setRunningDryRun(false)
      else setRunningLiveRun(false)
    }
  }

  const resetAndRunLiveOnce = async () => {
    const confirmed = window.confirm(
      ['자동매매(AUTO) 데이터 초기화 후 즉시 1회 실행합니다.', '직접 추가한 수동 데이터는 유지됩니다. 진행할까요?'].join(String.fromCharCode(10))
    )
    if (!confirmed) return

    await resetAutoTradeOnly()
    await runAutoCycleOnce(false, true)
  }

  return (
    <section className="container-app">
      <table className="xls-table xls-fit xls-fit--stack" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={3} style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-brand)' }}>
              설정 / 알림
            </td>
            <td className="xls-cell" colSpan={3} style={{ textAlign: 'right' }}>
              {!telegramLinked && (
                <Button variant="secondary" onClick={() => requestOpenProfileModal()}>
                  텔레그램 연결(선택)
                </Button>
              )}
            </td>
          </tr>
          {!telegramLinked && (
            <tr className="xls-row">
              <td className="xls-cell" colSpan={6} style={{ padding: '10px' }}>
                <TelegramLinkCallout
                  description="웹 전용 계정으로 모든 기능을 쓸 수 있고, 알림은 앱 푸시로 받습니다. 텔레그램을 연결하면 텔레그램 명령어와 텔레그램 알림도 쓸 수 있습니다."
                  onAction={() => requestOpenProfileModal()}
                />
              </td>
            </tr>
          )}
          <Detail>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>Telegram Chat ID</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              {telegramLinked ? (
                <Input label="Telegram Chat ID (선택)" value={chatId} onChange={(e:any) => setChatId(e.target.value)} placeholder="예: 123456789" />
              ) : (
                <div style={{ fontSize: 13 }}>웹 전용 계정 · 텔레그램 미연결 (연결은 프로필에서)</div>
              )}
              <div className="text-xs muted mt-2">웹 기본 기능에는 필수가 아닙니다. 알림 전송/텔레그램 연동 기능에만 사용됩니다.</div>
              <div className="text-xs muted mt-2">참고: 서버에 DEFAULT_TELEGRAM_CHAT_ID가 설정되어 있으면 기본값으로 불러옵니다.</div>
              <div className="text-xs muted mt-2">
                현재 권한: {accessInfo?.has_advanced_access ? '고급 기능 사용 가능' : '일반 기능만 사용 가능'}
                {accessInfo?.is_admin ? ' (관리자)' : ''}
              </div>
              {accessInfo?.is_admin && (
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      try {
                        window.location.hash = 'admin-users'
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    사용자 관리 페이지 열기
                  </Button>
                </div>
              )}
            </td>
          </tr>
          </Detail>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>자동매매 시드 자본금</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <label className="block muted">자동매매 예산의 기준이 되는 시드 자본금입니다. 자동매매 실행 시 이 금액을 기준으로 종목당 투자 비중이 계산됩니다.</label>
              <div className="mt-1" style={{ fontSize: 13, fontWeight: 600, color: virtualCash == null ? '#888' : virtualCash < 100000 ? '#c0392b' : '#27ae60' }}>
                {virtualCash == null
                  ? '현재 투자 가능 현금: 미초기화 — 아래 "저장 + 잔여 현금 초기화"로 설정하세요'
                  : <>
                      현재 투자 가능 현금: {formatKrwCompact(virtualCash)}
                      {virtualCash < 100000 && <span style={{ marginLeft: 8, fontWeight: 400, color: '#c0392b' }}>⚠ 현금 부족 — 자동매매 실행 불가</span>}
                    </>
                }
              </div>
              <div className="mt-2 grid-two">
                <Input
                  label="시드 자본금 (원)"
                  type="number"
                  value={seedCapital}
                  onChange={(e: any) => setSeedCapital(String(e?.target?.value || ''))}
                  placeholder="내가 감당할 수 있는 금액"
                />
              </div>
              <div className="mt-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <Button onClick={() => saveSeedCapital(false)} disabled={savingSeed} variant="primary">
                  {savingSeed ? '저장중…' : '저장'}
                </Button>
                <Button onClick={() => saveSeedCapital(true)} disabled={savingSeed} variant="secondary">
                  {savingSeed ? '처리중…' : '저장 + 잔여 현금 초기화'}
                </Button>
                {seedCapitalStatus && <div className="muted">{seedCapitalStatus}</div>}
              </div>
              <Detail>
              <div className="text-xs muted mt-2">
                잔여 현금 초기화: 자동매매로 누적된 매수/매도 내역을 리셋하고 현금을 시드 자본금으로 복원합니다. 포트폴리오 초기화 없이 예산만 재설정할 때 사용하세요.
              </div>
              </Detail>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>월 자동 입금</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <div className="muted" style={{ whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                실제로 매달 자동이체할 금액을 정하면, 가상 계좌에도 입금일에 같은 금액이 들어옵니다 (주말·휴일이면 다음 거래일). 입금은 수익률에 섞이지 않습니다.
              </div>
              <div className="mt-2 grid-two">
                <Input
                  label="월 입금액 (만원, 0이면 적립 안 함)"
                  type="number"
                  value={depositMan}
                  onChange={(e: any) => setDepositMan(String(e?.target?.value || ''))}
                  placeholder="예: 30"
                />
                <Input
                  label="입금일 (1~28일)"
                  type="number"
                  value={depositDay}
                  onChange={(e: any) => setDepositDay(String(e?.target?.value || ''))}
                  placeholder="예: 25"
                />
              </div>
              <div className="mt-2" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Button onClick={() => void saveDeposit()} disabled={savingDeposit} variant="primary">
                  {savingDeposit ? '저장중…' : '입금 설정 저장'}
                </Button>
                {depositStatus && <div className="muted">{depositStatus}</div>}
              </div>
              {deposit && (
                <div className="text-xs mt-2" style={{ lineHeight: 1.6 }}>
                  <div>
                    넣은 원금 누적: <strong>{deposit.total_deposited != null ? `${deposit.total_deposited.toLocaleString('ko-KR')}원` : '시드 미설정'}</strong>
                    {' · '}
                    {deposit.monthly_deposit > 0
                      ? <>매월 {deposit.deposit_day}일 {deposit.monthly_deposit.toLocaleString('ko-KR')}원 · 다음 입금 {deposit.next_deposit_date ?? '-'}</>
                      : '월 적립 안 함'}
                  </div>
                  {deposit.deposit_log.length > 0 && (
                    <div className="mt-1 muted">
                      최근 입금:{' '}
                      {deposit.deposit_log.map((r) => `${r.date.slice(5)} +${(r.amount / 10_000).toLocaleString('ko-KR')}만 → 현금 ${r.cashAfter.toLocaleString('ko-KR')}원`).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>자동매매 방식</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Button
                  variant={strategyMode === 'stock' ? 'primary' : 'secondary'}
                  disabled={savingMode || strategyMode == null}
                  onClick={() => void saveStrategyMode('stock')}
                >
                  종목 매매 봇 (기본)
                </Button>
                <Button
                  variant={strategyMode === 'index_hold' ? 'primary' : 'secondary'}
                  disabled={savingMode || strategyMode == null}
                  onClick={() => void saveStrategyMode('index_hold')}
                >
                  지수 보유 (초보자)
                </Button>
                {modeStatus && <div className="muted">{modeStatus}</div>}
              </div>
              <div className="text-xs muted mt-2">
                지수 보유: KODEX 200을 계속 들고, 월 자동 입금으로 들어온 돈도 KODEX 200을 삽니다. 파는 조건이 없어 내가 정한 시드 + 월 적립으로 그대로 따라 하기 쉽습니다.
              </div>
              <Detail>
              <div className="text-xs muted mt-1">
                검증(100만 + 월 50만 × 10년, 2002~2026 모든 시작 시점): 나쁜 경우 10%도 계속 보유 7,768만 vs 50일선 매매 6,610만 (원금 6,100만). 대신 도중에 원금의 73%까지 내려가는 구간을 견뎌야 합니다 (50일선은 91%). 떨어질 때 팔지 않고 적립을 이어가는 것이 전제입니다.
              </div>
              </Detail>
              {strategyMode === 'stock' && Number(seedCapital) > 0 && Number(seedCapital) < SMALL_SEED_LIMIT && (
                <div className="text-xs mt-1" style={{ color: '#c0392b', whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                  ⚠ 시드 {Number(seedCapital).toLocaleString('ko-KR')}원으로는 종목 매매 봇이 불리합니다. 과거 검증(2017~2026, 1주 단위 체결)에서 같은 20종목 전략이
                  시드 100만원이면 연 9.3%p, 300만원이면 1.9%p 손해였습니다 (한 칸 예산으로 살 수 있는 싼 종목만 골라짐). 1천만원 미만이면 지수 보유를 권합니다.
                </div>
              )}
              {strategyMode === 'index_hold' && (
                <div className="text-xs mt-1" style={{ color: 'var(--color-brand)' }}>
                  이 계정은 지수 보유 모드입니다 — 아래 종목 봇 설정(슬롯·점수·익절·손절)은 쓰이지 않고, "활성화"와 실행 버튼만 적용됩니다.
                </div>
              )}
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>가상 자동매매 설정</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <label className="block muted">가상 자동매매 설정</label>
              <div className="mt-2">
                <Checkbox label="활성화" checked={!!settings?.is_enabled} onChange={(v) => setSettings({...settings, is_enabled: v})} />
              </div>
              <div className="text-xs muted mt-1">
                순서: ① 시드 자본금 저장 → ② 월 자동 입금 설정(선택) → ③ 활성화 후 저장. 시드를 정하기 전에는 켤 수 없습니다.
              </div>
              <Detail>
              <div className="mt-2 grid-two">
                <div>
                  <Input label="회차당 신규 매수 슬롯" type="number" value={settings?.monday_buy_slots ?? 2} onChange={(e:any) => setSettings({...settings, monday_buy_slots: Number(e.target.value)})} />
                </div>
                <div>
                  <Input label="최대 포지션 수" type="number" value={settings?.max_positions ?? 10} onChange={(e:any) => setSettings({...settings, max_positions: Number(e.target.value)})} />
                </div>
              </div>
              <div className="mt-2 grid-two">
                <div>
                  <Input label="최소 매수 점수" type="number" value={settings?.min_buy_score ?? 72} onChange={(e:any) => setSettings({...settings, min_buy_score: Number(e.target.value)})} />
                </div>
                <div>
                  <Input label="장기 비중(%)" type="number" value={settings?.long_term_ratio ?? 70} onChange={(e:any) => setSettings({...settings, long_term_ratio: Number(e.target.value)})} />
                </div>
              </div>
              <div className="mt-2 grid-two">
                <div>
                  <Input label="익절(%)" type="number" value={settings?.take_profit_pct ?? 8} onChange={(e:any) => setSettings({...settings, take_profit_pct: Number(e.target.value)})} />
                </div>
                <div>
                  <Input label="손절(%)" type="number" value={settings?.stop_loss_pct ?? 4} onChange={(e:any) => setSettings({...settings, stop_loss_pct: Number(e.target.value)})} />
                </div>
              </div>
              </Detail>

              <div className="mt-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button onClick={saveSettings} disabled={saving} variant="primary">{saving ? '저장중…' : '저장'}</Button>
                  <Detail>
                  <Button onClick={resetAutoTradeOnly} disabled={resettingAutoOnly} variant="ghost">
                    {resettingAutoOnly ? '초기화중…' : '자동매매 데이터만 초기화'}
                  </Button>
                  </Detail>
                </div>
                {status && (
                  <div className="muted" style={{ minWidth: 0, marginLeft: 8, wordBreak: 'break-word' }}>{status}</div>
                )}
              </div>
              <Detail>
              <div className="text-xs muted mt-2">
                안내: 이 버튼은 자동매매(AUTO)로 생성된 이력만 정리합니다. 직접 추가한 수동 보유/거래는 유지됩니다.
              </div>
              <div className="mt-3 flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <Button
                  onClick={() => runAutoCycleOnce(true, true)}
                  disabled={runningDryRun || saving || resettingAutoOnly || runningLiveRun}
                  variant="secondary"
                >
                  {runningDryRun ? '점검중…' : '저장 후 점검 1회'}
                </Button>
                <Button
                  onClick={() => {
                    const ok = window.confirm('현재 설정으로 자동매매를 1회 실실행할까요?')
                    if (!ok) return
                    void runAutoCycleOnce(false, true)
                  }}
                  disabled={runningLiveRun || saving || resettingAutoOnly || runningDryRun}
                  variant="primary"
                >
                  {runningLiveRun ? '실행중…' : '저장 후 실행 1회'}
                </Button>
                <Button
                  onClick={resetAndRunLiveOnce}
                  disabled={runningLiveRun || saving || resettingAutoOnly || runningDryRun}
                  variant="ghost"
                >
                  초기화 후 실행 1회
                </Button>
              </div>
              <div className="text-xs muted mt-2">
                권장 순서: 저장 후 점검 1회 → 결과 확인 → 저장 후 실행 1회
              </div>
              </Detail>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>알림 받을 곳</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              {telegramLinked ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <Button
                      variant={notifyChannel === 'telegram' ? 'primary' : 'secondary'}
                      disabled={savingChannel || notifyChannel == null}
                      onClick={() => void saveNotifyChannel('telegram')}
                    >
                      텔레그램
                    </Button>
                    <Button
                      variant={notifyChannel === 'push' ? 'primary' : 'secondary'}
                      disabled={savingChannel || notifyChannel == null}
                      onClick={() => void saveNotifyChannel('push')}
                    >
                      브라우저 푸시 (PWA)
                    </Button>
                    {channelStatus && <div className="muted">{channelStatus}</div>}
                  </div>
                  <div className="text-xs muted mt-2" style={{ whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                    자동매매·리포트 알림을 고른 한 곳으로만 보냅니다 (중복 없음). 텔레그램에서 직접 입력한 명령의 답장과 [승인]·[보류] 같은 버튼 메시지, 파일은 항상 텔레그램으로 갑니다.
                    브라우저 푸시는 이 기기에서 프로필의 "브라우저 푸시 알림"을 켜 둬야 오고, 켜진 기기가 없으면 텔레그램으로 대신 보냅니다.
                  </div>
                </>
              ) : (
                <div className="muted" style={{ whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                  텔레그램이 연결되지 않은 계정이라 모든 알림을 브라우저 푸시로 받습니다. 프로필에서 "브라우저 푸시 알림"을 켜 두세요.
                </div>
              )}
            </td>
          </tr>
          <Detail>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>테스트 알림</td>
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <label className="block muted">테스트 알림</label>
              <div className="mt-2">
                <label className="block text-sm">테스트 메시지</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full p-2 border rounded h-24" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button onClick={sendTest} disabled={loading} variant="secondary">{loading ? '전송중…' : '테스트 전송'}</Button>
                {status && <div className="muted">{status}</div>}
              </div>
            </td>
          </tr>
          </Detail>
          {accessInfo?.is_admin && (
            <tr className="xls-row">
              <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
                <label className="block muted">고급 기능 사용자 관리 (관리자)</label>
                <div className="mt-2 grid-two">
                  <Input label="대상 Chat ID" value={adminTargetChatId} onChange={(e:any) => setAdminTargetChatId(e.target.value)} placeholder="예: 123456789" />
                  <Input label="닉네임(선택)" value={adminNickname} onChange={(e:any) => setAdminNickname(e.target.value)} placeholder="예: 운영팀" />
                </div>
                <div className="mt-2">
                  <Input label="메모(선택)" value={adminNote} onChange={(e:any) => setAdminNote(e.target.value)} placeholder="권한 부여 사유" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={upsertAccessUser} disabled={adminLoading} variant="primary">
                    {adminLoading ? '처리중…' : '추가/갱신'}
                  </Button>
                </div>

                <div className="mt-3" style={{ overflowX: 'auto' }}>
                  <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Chat ID</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>닉네임</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>메모</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>상태</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRows.map((row) => (
                    <tr key={row.chat_id}>
                      <td style={{ padding: '8px 6px' }}>{row.chat_id}</td>
                      <td style={{ padding: '8px 6px' }}>{row.nickname || '-'}</td>
                      <td style={{ padding: '8px 6px' }}>{row.note || '-'}</td>
                      <td style={{ padding: '8px 6px' }}>{row.is_enabled ? '허용' : '차단'}</td>
                      <td style={{ padding: '8px 6px', display: 'flex', gap: 8 }}>
                        <Button
                          variant="secondary"
                          disabled={adminLoading}
                          onClick={() => toggleAccessUser(row.chat_id, !row.is_enabled)}
                        >
                          {row.is_enabled ? '차단' : '허용'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={adminLoading}
                          onClick={() => removeAccessUser(row.chat_id)}
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {accessRows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '10px 6px' }} className="muted">등록된 고급 기능 사용자가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
                  </table>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
