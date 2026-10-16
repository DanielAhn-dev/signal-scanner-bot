import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CREDIT_RATE_HIGH, CREDIT_RATE_LOW, EARLY_WITHDRAWAL_TAX_RATE, PENSION_SAVING_LIMIT_WON, PENSION_TOTAL_LIMIT_WON, TAX_RULES_YEAR } from '../../lib/taxShelter'

/**
 * 노후 준비 3층 점검(국민연금·퇴직연금·개인연금) + ISA. 고르기만 하면 되고 저장하지 않는다 —
 * 고른 답은 아래 안내 한 줄과 계획 점검으로 가는 링크만 바꾼다. 수익 약속 없이, 확인된 세금 숫자만 쓴다(taxShelter.ts).
 */
type Answer = 'yes' | 'no'
type LayerKey = 'nps' | 'company' | 'personal'

// 환급액(118.8만원 등)은 계획 점검 화면과 같게 소수 한 자리까지
const man = (won: number) => `${(won / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`

const LAYERS: Array<{ key: LayerKey; title: string; yes: { text: string; link?: [string, string] }; no: { text: string; link?: [string, string] } }> = [
  {
    key: 'nps', title: '1층 국민연금',
    yes: { text: '예상 월 수령액(국민연금공단 "내 연금 알아보기")을 은퇴 인출 탭에 넣으면 노후에 꺼내 쓸 계획에 함께 반영됩니다.', link: ['/plan?tab=retire', '수령액 넣어 보기'] },
    no: { text: '직장인·사업자는 보통 자동으로 가입돼 있습니다. 가입 여부와 예상 수령액은 국민연금공단 "내 연금 알아보기"에서 확인할 수 있습니다.' },
  },
  {
    key: 'company', title: '2층 퇴직연금(회사)',
    yes: { text: '회사가 쌓아 주는 몫이라 따로 할 일은 없습니다. 운용 방식(DB·DC)은 회사 담당자나 퇴직연금 앱에서 볼 수 있습니다.' },
    no: { text: '회사에 퇴직연금이 있는지는 인사·급여 담당에게 물어보면 됩니다. 없거나 사업자라면 3층 개인연금이 더 중요해집니다.' },
  },
  {
    key: 'personal', title: '3층 개인연금(연금저축·IRP)',
    yes: { text: `한도(연금저축 ${man(PENSION_SAVING_LIMIT_WON)}, IRP 합쳐 ${man(PENSION_TOTAL_LIMIT_WON)})를 채웠는지, 연금계좌에 무엇을 담으면 좋은지 절세 계좌 탭에서 볼 수 있습니다.`, link: ['/plan?tab=tax', '절세 계좌 확인하기'] },
    no: {
      text: `넣은 해 연말정산에서 돌려받습니다. 한 해 ${man(PENSION_TOTAL_LIMIT_WON)}까지 인정되고, 다 채우면 최대 ${man(PENSION_TOTAL_LIMIT_WON * CREDIT_RATE_HIGH)}~${man(PENSION_TOTAL_LIMIT_WON * CREDIT_RATE_LOW)}(급여에 따라 갈림)입니다. 다만 55세 전에 해지하면 ${(EARLY_WITHDRAWAL_TAX_RATE * 100).toFixed(1)}% 세금이 붙으니 오래 둘 돈만 넣으세요.`,
      link: ['/plan?tab=tax', '내가 돌려받을 돈 계산해 보기'],
    },
  },
]

export default function RetirementLayers({ initial = {} }: { initial?: Partial<Record<LayerKey, Answer>> }) {
  const [answers, setAnswers] = useState<Partial<Record<LayerKey, Answer>>>(initial)
  return (
    <section className="start-card start-layers" aria-label="노후 준비 점검">
      <p className="start-question">노후 준비, 어디까지 되어 있나요? <small>(선택)</small></p>
      <p className="start-note">고르기만 하면 됩니다. 저장하지 않고, 필요한 곳만 안내합니다.</p>
      {LAYERS.map((layer) => {
        const answer = answers[layer.key] ?? initial[layer.key]
        const guide = answer ? layer[answer] : null
        return (
          <div key={layer.key} className="start-layer">
            <div className="start-layer-head">
              <span>{layer.title}</span>
              <div className="start-segment" role="group" aria-label={layer.title}>
                {([['yes', '있음'], ['no', '없음·모름']] as const).map(([value, label]) => (
                  <button key={value} type="button" className={answer === value ? 'is-active' : ''} aria-pressed={answer === value} onClick={() => setAnswers((cur) => ({ ...cur, [layer.key]: value }))}>{label}</button>
                ))}
              </div>
            </div>
            {guide && <p className="start-note">{guide.text}{guide.link && <> <Link to={guide.link[0]}>{guide.link[1]} →</Link></>}</p>}
          </div>
        )
      })}
      <div className="start-layer">
        <div className="start-layer-head"><span>ISA</span></div>
        <p className="start-note">{TAX_RULES_YEAR}년 제도 개편이 논의 중이라, 한도·세금 숫자는 개편이 확정된 뒤에 안내합니다.</p>
      </div>
      <p className="start-note start-basis">세금 숫자는 {TAX_RULES_YEAR}년 기준(2026-10-07 확인, 국세청 원문 미확인)입니다. 가입 전 금융사·국세청 안내로 한 번 더 확인하세요.</p>
    </section>
  )
}
