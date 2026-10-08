import { useEffect, useState } from 'react'
import { DROP_COMMITMENTS, dropPlanLines, sanitizeDropPlan, todayKst, type DropPlan } from '../../lib/dropPlan'
import { useUserState } from '../../lib/userState'

/** 하락 전에 차분할 때 정해 두는 계획. 저장하면 하락이 왔을 때 모아가기 화면의 '지금 상황'에 다시 보여준다. */
export default function DropPlanCard({ tolerance }: { tolerance: number }) {
  const { value, set } = useUserState<DropPlan>('dropPlan')
  const saved = sanitizeDropPlan(value)
  const [picked, setPicked] = useState<string[]>(saved?.commitments ?? DROP_COMMITMENTS.map((c) => c.id))
  const [ifTempted, setIfTempted] = useState(saved?.ifTempted ?? '')
  const [editing, setEditing] = useState(false)

  // 저장된 계획이 서버에서 늦게 도착하면 한 번 반영한다
  useEffect(() => {
    if (saved && !editing) { setPicked(saved.commitments); setIfTempted(saved.ifTempted) }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const canSave = picked.length > 0 || ifTempted.trim().length > 0
  const save = () => {
    set({ savedAt: todayKst(), tolerancePct: tolerance, commitments: picked, ifTempted: ifTempted.trim().slice(0, 200) })
    setEditing(false)
  }

  if (saved && !editing) {
    return (
      <section className="acc-card">
        <h2>하락이 오면 내가 할 일</h2>
        <p className="acc-note">{saved.savedAt}에 정했습니다. 잃어도 버틸 수 있다고 정한 선은 {saved.tolerancePct}%입니다. 하락이 오면 모아가기 화면의 "지금 상황"에서 이 계획을 다시 보여드립니다.</p>
        <ul className="acc-note">{dropPlanLines(saved).map((l) => <li key={l}>{l}</li>)}</ul>
        <button type="button" className="acc-secondary" onClick={() => setEditing(true)}>계획 고치기</button>
      </section>
    )
  }

  return (
    <section className="acc-card">
      <h2>하락이 오면 내가 할 일, 미리 정해 두기</h2>
      <p className="acc-note">하락 한가운데에서는 판단이 흔들립니다. 지금처럼 차분할 때 정한 문장을 하락이 왔을 때 다시 보여드립니다. 시스템이 대신 결정하지 않고, 나중의 내가 읽기만 합니다.</p>
      {DROP_COMMITMENTS.map((c) => (
        <label key={c.id} className="mix-check">
          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
          <span>{c.text}</span>
        </label>
      ))}
      <label className="acc-field">
        <span>잃은 폭이 {tolerance}%를 넘어 팔고 싶어지면 먼저 할 일 (직접 적기, 선택)</span>
        <input type="text" maxLength={200} value={ifTempted} placeholder="예: 배우자에게 이야기하고, 하루 뒤에 결정한다" onChange={(e) => setIfTempted(e.target.value)} />
      </label>
      <button type="button" className="acc-primary" disabled={!canSave} onClick={save}>이 계획으로 정하기</button>
    </section>
  )
}
