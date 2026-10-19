import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../../lib/api'
import { stockCapFor } from '../../../lib/planGuide'
import { useCurrentChatId } from '../../../stores/profileStore'

/**
 * 실제 계좌(내가 직접 매매) 탭 위의 안내 — 방향은 '내 계획'을 물려받고, 계좌마다 고르는 건 사용 시점뿐이다
 * (docs/plan-real-vs-experiment-ux-2026-10-12.md). 성향·손절 같은 계좌별 정책은 관리자 화면에만 둔다.
 * 통장 종류는 따로 저장하지 않고 계좌 이름(ISA·연금·IRP)으로 알아보기만 한다 — 읽는 코드가 없는 설정을 만들지 않는다.
 */
type Plan = { tolerancePct: number | null; satellitePct: number }

const TAX_ACCOUNT = /ISA|연금|IRP/i

export default function AccountDirectionCard({ accountName }: { accountName: string | null }) {
  const navigate = useNavigate()
  const chatId = useCurrentChatId()
  const [plan, setPlan] = useState<Plan | null>(null)

  useEffect(() => {
    if (!chatId) return
    let active = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 30_000, retries: 0 })
      .then((res) => { if (active && res?.data?.plan) setPlan(res.data.plan as Plan) })
      .catch(() => {})
    return () => { active = false }
  }, [chatId])

  const direction = plan == null
    ? null
    : plan.tolerancePct == null
      ? '버틸 하락폭을 정하면 이 계좌에 둘 주식 비중을 알려드려요'
      : `주식 ${stockCapFor(plan.tolerancePct).recommended}%부터 (버틸 하락 −${plan.tolerancePct}%)`

  return (
    <div className="card mb-4 portfolio-direction-card">
      <div className="title-md">이 계좌의 방향</div>
      <ul className="portfolio-direction-list">
        <li>
          <strong>내 계획을 따릅니다</strong>{direction ? ` — ${direction}` : ''}.
          {' '}<button type="button" className="portfolio-direction-link" onClick={() => navigate('/accumulate#my-plan')}>내 계획 바꾸기 <ChevronRight size={12} aria-hidden /></button>
        </li>
        <li>
          날짜가 정해진 돈(전세금·학자금 등)이면 사용 시점을 정해 두세요. 날짜에 맞춰 주식 비중을 줄이는 안내가 나옵니다.
          {' '}<button type="button" className="portfolio-direction-link" onClick={() => navigate('/plan?tab=goal')}>사용 시점 정하기 <ChevronRight size={12} aria-hidden /></button>
        </li>
        {accountName && TAX_ACCOUNT.test(accountName) && (
          <li>
            세금 혜택 계좌(ISA·연금)로 보여요. 넣는 순서와 환급을 확인해 보세요.
            {' '}<button type="button" className="portfolio-direction-link" onClick={() => navigate('/plan?tab=tax')}>절세 계좌 보기 <ChevronRight size={12} aria-hidden /></button>
          </li>
        )}
        <li>
          목표 비중과의 차이와 옮길 금액은 <button type="button" className="portfolio-direction-link" onClick={() => navigate('/income-guide')}>리밸런싱 제안 <ChevronRight size={12} aria-hidden /></button>에서 봅니다.
        </li>
      </ul>
      <p className="caption muted">입금·자동매매는 실험 계좌에만 걸립니다. 이 계좌는 직접 사고판 것을 기록하고 관리하는 곳입니다.</p>
    </div>
  )
}
