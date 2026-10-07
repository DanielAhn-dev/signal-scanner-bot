import React from 'react'
import { apiFetch } from '../../lib/api'
import { DEFAULT_RETIRE_AGE, RETIRE_AGE_MAX, RETIRE_AGE_MIN, ageAt } from '../../../../src/services/goalTracker'

type Life = { birthMonth: string; retireAge: number } | null

const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const QUICK_AGES = [55, 60, 65]

/**
 * 나이·은퇴 시점 — 목표 트래커가 "언젠가"가 아니라 이 은퇴 나이에 맞춰 매달 모을 금액을 계산한다.
 * 출생은 연월만 받는다(일은 계산에 영향이 없고 개인정보는 최소로). 저장: users.prefs (/api/ui/investment-prefs).
 */
export default function LifeProfileCard({ onSaved, compact = false }: { onSaved?: (life: Life) => void; compact?: boolean }) {
  const [birth, setBirth] = React.useState('')
  const [retireAge, setRetireAge] = React.useState(String(DEFAULT_RETIRE_AGE))
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      .then((res) => {
        if (!alive) return
        const life = res?.data?.life as Life
        if (life) {
          setBirth(life.birthMonth)
          setRetireAge(String(life.retireAge))
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  const today = todayKst()
  const validBirth = /^\d{4}-(0[1-9]|1[0-2])$/.test(birth) && birth <= today.slice(0, 7)
  const age = validBirth ? ageAt(birth, today) : null
  const ra = Number(retireAge)
  const validAge = Number.isInteger(ra) && ra >= RETIRE_AGE_MIN && ra <= RETIRE_AGE_MAX
  const yearsLeft = age != null && validAge ? ra - age : null

  const save = async (clear = false) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        retries: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ life_profile: clear ? { birthMonth: '' } : { birthMonth: birth, retireAge: ra } }),
      })
      if (res?.error) throw new Error(res.error)
      const life = (res?.data?.life ?? null) as Life
      if (clear) {
        setBirth('')
        setRetireAge(String(DEFAULT_RETIRE_AGE))
      }
      setMsg(clear ? '나이 정보를 지웠습니다.' : '저장했습니다. 목표 트래커가 이 은퇴 나이에 맞춰 계산합니다.')
      onSaved?.(life)
    } catch (e) {
      setMsg(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="profile-section" aria-label="나이와 은퇴 시점">
      <div className="profile-section-title">나이 · 은퇴 시점</div>
      {!compact && (
        <p className="profile-hint">
          은퇴하고 싶은 나이를 정하면, 목표 트래커가 그때까지 매달 얼마를 모으면 되는지 계산합니다. 출생은 연월만 받습니다.
        </p>
      )}
      <label className="profile-field-label" htmlFor="life-birth">태어난 연월</label>
      <input
        id="life-birth"
        className="ui-text"
        type="month"
        value={birth}
        max={today.slice(0, 7)}
        disabled={!loaded || busy}
        onChange={(e) => setBirth(e.target.value)}
      />
      <label className="profile-field-label" htmlFor="life-retire">은퇴하고 싶은 나이 (만)</label>
      <div className="profile-field-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {QUICK_AGES.map((a) => (
          <button
            key={a}
            type="button"
            className={`ui-button ${String(a) === retireAge ? '' : 'ui-btn-ghost'}`}
            aria-pressed={String(a) === retireAge}
            disabled={!loaded || busy}
            onClick={() => setRetireAge(String(a))}
          >
            {a}세
          </button>
        ))}
        <input
          id="life-retire"
          className="ui-text"
          type="number"
          inputMode="numeric"
          min={RETIRE_AGE_MIN}
          max={RETIRE_AGE_MAX}
          style={{ width: 90 }}
          value={retireAge}
          disabled={!loaded || busy}
          onChange={(e) => setRetireAge(e.target.value)}
        />
      </div>
      {age != null && (
        <p className="profile-hint" role="status">
          지금 만 {age}세
          {yearsLeft != null && (yearsLeft > 0 ? ` · 은퇴까지 약 ${yearsLeft}년` : ' · 이미 은퇴 나이입니다')}
        </p>
      )}
      {!validAge && retireAge !== '' && (
        <p className="profile-hint" style={{ color: 'var(--color-error)' }}>
          은퇴 나이는 {RETIRE_AGE_MIN}~{RETIRE_AGE_MAX}세로 입력하세요.
        </p>
      )}
      <div className="profile-field-row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="ui-button" disabled={!loaded || busy || !validBirth || !validAge} onClick={() => void save()}>
          {busy ? '저장 중…' : '저장'}
        </button>
        {birth && (
          <button type="button" className="ui-button ui-btn-ghost" disabled={busy} onClick={() => void save(true)}>
            지우기
          </button>
        )}
      </div>
      {msg && <p className="profile-hint" role="status">{msg}</p>}
    </section>
  )
}
