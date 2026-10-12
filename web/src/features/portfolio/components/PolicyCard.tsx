import { ChevronRight } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Modal from '../../../components/Modal'
import type { AccountPolicy } from '../types'
import { accountLabel } from '../lib/accountKey'

type PolicyCardProps = {
  selectedAccountKey: string
  policyDraft: AccountPolicy | null
  setPolicyDraft: React.Dispatch<React.SetStateAction<AccountPolicy | null>>
  policyLoading: boolean
  policySaving: boolean
  savePolicyDraft: () => Promise<void> | void
  policyAccordionOpen: boolean
  setPolicyAccordionOpen: (open: boolean) => void
}

export default function PolicyCard({
  selectedAccountKey,
  policyDraft,
  setPolicyDraft,
  policyLoading,
  policySaving,
  savePolicyDraft,
  policyAccordionOpen,
  setPolicyAccordionOpen,
}: PolicyCardProps) {
  return (
    <div className="card mb-4 portfolio-policy-card">
      <button
        type="button"
        className="portfolio-policy-head"
        onClick={() => setPolicyAccordionOpen(true)}
        aria-haspopup="dialog"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 0,
        }}
      >
        <div>
          <div className="title-md">계좌별 위험정책</div>
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            {selectedAccountKey === 'real'
              ? '계좌 폴더를 선택하면 정책 설정'
              : selectedAccountKey === 'virtual'
                ? '실험 계좌는 개별 정책 미적용'
                : `${accountLabel(policyDraft?.broker_name, policyDraft?.account_name)} ${policyLoading ? '조회 중...' : ''}`
            }
          </div>
        </div>
        <ChevronRight size={20} style={{ flexShrink: 0 }} />
      </button>

      <Modal isOpen={policyAccordionOpen} title="계좌별 위험정책" onClose={() => setPolicyAccordionOpen(false)} size="sm">
        <div className="portfolio-policy-body">
          {selectedAccountKey === 'real' ? (
            <div className="caption muted">계좌 폴더를 선택하면 해당 계좌의 정책(최대보유/일손실/현금비중/점수 가감)을 설정할 수 있습니다.</div>
          ) : selectedAccountKey === 'virtual' ? (
            <div className="caption muted">실험 계좌는 개별 계좌 정책 대상이 아닙니다. 실제 계좌 탭을 선택하면 정책을 설정할 수 있습니다.</div>
          ) : policyDraft ? (
            <>
              <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
                대상: {accountLabel(policyDraft.broker_name, policyDraft.account_name)}
                {policyLoading ? ' · 정책 조회 중...' : ''}
              </div>
              <div className="portfolio-policy-grid">
                <label className="ui-label">
                  <span>리스크 프로필</span>
                  <select
                    className="input"
                    value={String(policyDraft.risk_profile)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, risk_profile: (String(e?.target?.value || 'balanced') as any) } : prev)}
                  >
                    <option value="safe">safe</option>
                    <option value="balanced">balanced</option>
                    <option value="active">active</option>
                    <option value="value-swing">value-swing (가치투자 스윙)</option>
                  </select>
                </label>
                <Input
                  label="최대 보유 종목 수"
                  type="number"
                  value={policyDraft.max_positions == null ? '' : String(policyDraft.max_positions)}
                  onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, max_positions: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                />
                <Input
                  label="일손실 한도(%)"
                  type="number"
                  value={policyDraft.daily_loss_limit_pct == null ? '' : String(policyDraft.daily_loss_limit_pct)}
                  onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, daily_loss_limit_pct: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                />
                <Input
                  label="최소 현금 비중(%)"
                  type="number"
                  value={policyDraft.min_cash_reserve_pct == null ? '' : String(policyDraft.min_cash_reserve_pct)}
                  onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, min_cash_reserve_pct: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                />
                <Input
                  label="추가매수 점수 가감"
                  type="number"
                  value={String(policyDraft.add_entry_score_adjust || 0)}
                  onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, add_entry_score_adjust: Number(e?.target?.value || 0) } : prev)}
                />
                <Input
                  label="부분익절 기준 가감(%p)"
                  type="number"
                  value={String(policyDraft.partial_take_profit_adjust_pct || 0)}
                  onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, partial_take_profit_adjust_pct: Number(e?.target?.value || 0) } : prev)}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" onClick={() => { void savePolicyDraft() }} disabled={policySaving}>
                  {policySaving ? '저장 중...' : '정책 저장'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
