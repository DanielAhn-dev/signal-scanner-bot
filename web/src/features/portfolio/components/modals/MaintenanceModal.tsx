import { ArrowLeft } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import Input from '../../../../components/ui/Input'
import Modal from '../../../../components/Modal'
import StockSearchInput from '../../../../components/StockSearchInput'
import type { AccountFolder } from '../../types'
import { accountLabel } from '../../lib/accountKey'
import { getTodayLocalYmd } from '../../lib/dates'
import type { MaintenanceState } from '../../hooks/useMaintenance'

export default function MaintenanceModal({ maint, accountFolders }: { maint: MaintenanceState; accountFolders: AccountFolder[] }) {
  const {
    maintModalOpen,
    setMaintModalOpen,
    maintMode,
    maintStep,
    setMaintStep,
    maintRow,
    maintCode,
    setMaintCode,
    maintQty,
    setMaintQty,
    maintBuyDate,
    setMaintBuyDate,
    maintBuyPrice,
    setMaintBuyPrice,
    maintBrokerName,
    setMaintBrokerName,
    maintAccountName,
    setMaintAccountName,
    maintAccountMode,
    setMaintAccountMode,
    maintError,
    setMaintError,
    maintLoading,
    runMaintenance,
  } = maint
  return (
    <Modal
      isOpen={maintModalOpen}
      title={
        maintMode === 'liquidateall' ? '전체매도' :
        maintMode === 'holdingrestore' ? (maintStep === 1 ? '1단계 · 계좌 설정' : '2단계 · 종목 추가') :
        '보유 종목 수정'
      }
      onClose={() => setMaintModalOpen(false)}
      size="sm"
    >
      {maintMode === 'liquidateall' && (
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          현재 보유 종목을 기준가로 일괄 매도 처리합니다. 실행 후 보유수량이 0으로 전환됩니다.
        </div>
      )}

      {maintMode === 'holdingedit' && (
        <>
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            <strong>{maintRow?.stock_name || maintCode || '종목'}</strong>의 매수가/수량/계좌를 수정합니다.
          </div>
          <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="ui-label">종목코드</label>
            <StockSearchInput
              value={maintCode}
              onChange={(v) => setMaintCode(v.toUpperCase())}
              onSelect={(s) => setMaintCode(s.code)}
              placeholder="예) 005930 또는 종목명"
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Input 
              label="보유 수량" 
              type="number" 
              value={maintQty === '' ? '' : String(maintQty)} 
              onChange={(e: any) => setMaintQty(e?.target?.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Input
              label="최초 매수일"
              type="date"
              value={maintBuyDate}
              onChange={(e: any) => setMaintBuyDate(String(e?.target?.value || getTodayLocalYmd()))}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Input
              label="평균 매수가 (원)"
              type="number"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
            <Input 
              label="증권사" 
              placeholder="예) NH, 토스, 삼성" 
              value={maintBrokerName} 
              onChange={(e: any) => setMaintBrokerName(String(e?.target?.value || ''))}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <Input 
              label="계좌명" 
              placeholder="예) ISA, 연금, 일반" 
              value={maintAccountName} 
              onChange={(e: any) => setMaintAccountName(String(e?.target?.value || ''))}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
        </>
      )}

      {maintMode === 'holdingrestore' && maintStep === 1 && (
        <>
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            매매 계좌 정보를 입력합니다. 증권사와 계좌명이 계좌 폴더의 기준이 됩니다.
          </div>

          {accountFolders.length > 0 && maintAccountMode === 'select' && (
            <>
              <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
                <label className="ui-label">기존 계좌 선택</label>
                <select
                  className="input"
                  value={maintBrokerName || maintAccountName ? `${maintBrokerName}||${maintAccountName}` : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '__new__') {
                      setMaintBrokerName('')
                      setMaintAccountName('')
                      setMaintAccountMode('manual')
                    } else {
                      const [broker, account] = val.split('||')
                      setMaintBrokerName(broker ?? '')
                      setMaintAccountName(account ?? '')
                    }
                  }}
                >
                  <option value="">계좌를 선택하세요</option>
                  {accountFolders.map((f) => {
                    // 빈 칸도 자리를 지켜야 계좌명만 있는 계좌가 증권사 칸으로 밀려 들어가지 않는다
                    const val = `${f.brokerName || ''}||${f.accountName || ''}`
                    return (
                      <option key={f.key} value={val}>
                        {accountLabel(f.brokerName, f.accountName)} ({f.count}종목)
                      </option>
                    )
                  })}
                  <option value="__new__">➕ 새로 입력하기</option>
                </select>
              </div>
            </>
          )}

          {(accountFolders.length === 0 || maintAccountMode === 'manual') && (
            <>
              {accountFolders.length > 0 && (
                <button
                  type="button"
                  className="caption"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', marginBottom: 'var(--space-2)', padding: 0 }}
                  onClick={() => {
                    setMaintBrokerName('')
                    setMaintAccountName('')
                    setMaintAccountMode('select')
                  }}
                >
                  <ArrowLeft size={14} aria-hidden /> 기존 계좌에서 선택
                </button>
              )}
              <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
                <Input
                  label="증권사"
                  placeholder="예) 토스, NH, 삼성"
                  value={maintBrokerName}
                  onChange={(e: any) => setMaintBrokerName(String(e?.target?.value || ''))}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <Input
                  label="계좌명"
                  placeholder="예) ISA, 연금, 일반"
                  value={maintAccountName}
                  onChange={(e: any) => setMaintAccountName(String(e?.target?.value || ''))}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
                예) 증권사: 토스증권 / 계좌명: ISA → 화면에 <strong>토스증권 / ISA</strong> 폴더로 표시됩니다.
              </div>
            </>
          )}

          {maintError && (
            <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="state-error-title">{maintError}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="primary"
              onClick={() => {
                if (!String(maintBrokerName || '').trim() && !String(maintAccountName || '').trim()) {
                  setMaintError('증권사 또는 계좌명을 입력해 주세요')
                  return
                }
                setMaintError(null)
                setMaintStep(2)
              }}
            >
              다음 → 종목 추가
            </Button>
            <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
          </div>
        </>
      )}

      {maintMode === 'holdingrestore' && maintStep === 2 && (
        <>
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            계좌: <strong>{[maintBrokerName, maintAccountName].filter(Boolean).join(' / ') || '미지정'}</strong>
            <br />추가할 종목의 매수 정보를 입력합니다.
          </div>
          <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="ui-label">종목코드</label>
            <StockSearchInput
              value={maintCode}
              onChange={(v) => setMaintCode(v.toUpperCase())}
              onSelect={(s) => setMaintCode(s.code)}
              placeholder="예) 005930 또는 종목명"
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Input
              label="보유 수량"
              type="number"
              value={maintQty === '' ? '' : String(maintQty)}
              onChange={(e: any) => setMaintQty(e?.target?.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
            />
          </div>
          <Input
            label="평균 매수가 (원)"
            type="number"
            placeholder="예) 75000"
            value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
            onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
          />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Input
              label="최초 매수일"
              type="date"
              value={maintBuyDate}
              onChange={(e: any) => setMaintBuyDate(String(e?.target?.value || getTodayLocalYmd()))}
            />
          </div>
          <div className="caption muted" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
            저장 후 가상매도 시 수익/손실이 자동 기록됩니다.
          </div>
          {maintError && (
            <div className="state-error" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <div className="state-error-title">{maintError}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
              {maintLoading ? '저장 중…' : '종목 저장'}
            </Button>
            <Button variant="secondary" onClick={() => { setMaintError(null); setMaintStep(1) }}><ArrowLeft size={14} aria-hidden /> 계좌 수정</Button>
            <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
          </div>
        </>
      )}

      {maintMode === 'liquidateall' && (
        <>
          {maintError && (
            <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div className="state-error-title">{maintError}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
              {maintLoading ? '처리 중…' : '전체매도 실행'}
            </Button>
            <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
          </div>
        </>
      )}

      {maintMode === 'holdingedit' && (
        <>
          {maintError && (
            <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div className="state-error-title">{maintError}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
              {maintLoading ? '저장 중…' : '수정 저장'}
            </Button>
            <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
