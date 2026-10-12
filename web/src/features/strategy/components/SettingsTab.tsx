import React from 'react'
import Collapsible from '../../../components/ui/Collapsible'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Checkbox from '../../../components/ui/Checkbox'
import Skeleton from '../../../components/Skeleton'
import { COLOR_NEGATIVE, COLOR_POSITIVE, STRATEGY_OPTIONS } from '../constants'
import type { AutoTradeSettings } from '../types'

export type SettingsTabProps = {
  settings: AutoTradeSettings | null
  settingsLoading: boolean
  setSettings: (next: AutoTradeSettings | null) => void
  saving: boolean
  saveStatus: string | null
  saveSettings: () => void | Promise<void>
}

export default function SettingsTab({
  settings,
  settingsLoading,
  setSettings,
  saving,
  saveStatus,
  saveSettings,
}: SettingsTabProps) {
  return (
    <div className="cards-list">
      {settingsLoading && <div className="card"><Skeleton lines={5} height={14} /></div>}
      {!settingsLoading && (
        <>
          <div className="card">
            <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>운용 전략 선택</div>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              시장 위험도와 현재 계좌 상황에 맞는 전략을 선택합니다. 변경 후 저장하면 다음 자동매매 사이클부터 적용됩니다.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {STRATEGY_OPTIONS.map((option) => {
                const isActive = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase() === option.id
                return (
                  <div
                    key={option.id}
                    onClick={() => setSettings({ ...settings, selected_strategy: option.id })}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-card)',
                      border: isActive ? `2px solid ${option.color}` : '1.5px solid var(--color-border-default)',
                      background: isActive ? `color-mix(in srgb, ${option.color} 8%, var(--color-surface-card))` : 'var(--color-surface-card)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `2px solid ${option.color}`,
                        background: isActive ? option.color : 'transparent',
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, color: isActive ? option.color : 'inherit' }}>{option.label}</div>
                      <div className="muted" style={{ marginTop: 2 }}>{option.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card">
            <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>자동매매 제어</div>
            <Checkbox
              label="자동매매 활성화"
              checked={!!settings?.is_enabled}
              onChange={(value) => setSettings({ ...settings, is_enabled: value })}
            />
            <div className="muted mt-2">비활성화하면 스케줄 실행 시 매매 없이 분석만 수행합니다.</div>
          </div>

          <Collapsible title="세부 기준" hint="매수 점수·익절·손절 — 처음엔 기본값 그대로 두세요">
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              지난 10년 검증에서 매수 점수·익절·손절 값을 바꿔서 수익이 나아진 근거는 찾지 못했습니다. 바꾸고 싶을 때만 조정하세요.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input
                label="최소 매수 점수"
                type="number"
                value={settings?.min_buy_score ?? 72}
                onChange={(e: any) => setSettings({ ...settings, min_buy_score: Number(e.target.value) })}
              />
              <Input
                label="최대 보유 종목 수"
                type="number"
                value={settings?.max_positions ?? 10}
                onChange={(e: any) => setSettings({ ...settings, max_positions: Number(e.target.value) })}
              />
              <Input
                label="익절 (%)"
                type="number"
                value={settings?.take_profit_pct ?? 8}
                onChange={(e: any) => setSettings({ ...settings, take_profit_pct: Number(e.target.value) })}
              />
              <Input
                label="손절 (%)"
                type="number"
                value={settings?.stop_loss_pct ?? 4}
                onChange={(e: any) => setSettings({ ...settings, stop_loss_pct: Number(e.target.value) })}
              />
              <Input
                label="회차당 신규 매수 슬롯"
                type="number"
                value={settings?.monday_buy_slots ?? 2}
                onChange={(e: any) => setSettings({ ...settings, monday_buy_slots: Number(e.target.value) })}
              />
              <Input
                label="장기 포지션 비중 (%)"
                type="number"
                value={settings?.long_term_ratio ?? 70}
                onChange={(e: any) => setSettings({ ...settings, long_term_ratio: Number(e.target.value) })}
              />
            </div>
            <div className="muted mt-2" style={{ fontSize: 'var(--font-size-sm)' }}>
              최소 매수 점수는 스캔 컷오프, 익절·손절은 가상 자동매매 기준, 장기 포지션 비중은 장기 보유 목표 비율입니다.
            </div>
          </Collapsible>


          <Collapsible title="전략별 동작 방식" hint="세 전략이 각각 무엇을 하는지">
            
            {STRATEGY_OPTIONS.map((option) => (
              <div
                key={option.id}
                style={{
                  marginBottom: 16,
                  paddingBottom: 16,
                  borderBottom: '1px solid var(--color-border-default)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: option.color,
                    }}
                  />
                  <div style={{ fontWeight: 600 }}>{option.label}</div>
                </div>
                
                {option.id === 'HOLD_SAFE' && (
                  <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                    <strong>기본 전략:</strong> 보수적 진입<br/>
                    <strong>권장 설정:</strong> 기본(base) 2~3종목 | 강세장 ×1.3 | 약세장 ×0.7<br/>
                    <strong>동작:</strong> 기준을 높여 진입 수를 줄임. 강세장이면 3~4종목, 약세장이면 1~2종목으로 조정
                  </div>
                )}
                {option.id === 'REDUCE_TIGHT' && (
                  <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                    <strong>기본 전략:</strong> 신속한 리스크 관리<br/>
                    <strong>권장 설정:</strong> 기본(base) 1~2종목 | 강세장 ×2.0 | 약세장 ×0.3<br/>
                    <strong>동작:</strong> 좋은 신호에서만 과감하게. 강세장 확인 시 2~4종목까지 진입, 약세장은 진입 제한<br/>
                    <strong>손절:</strong> 2%·4%로 고정되지 않습니다. 종목마다 변동성(ATR)에 따라 넓어져(기본폭의 최대 2.5배, 예: 4% → 10%) 실제 손절이 −7% 안팎까지 갈 수 있고, 휴장·주말처럼 점검 사이에 생긴 갭은 막지 못합니다
                  </div>
                )}
                {option.id === 'WAIT_AND_DIP_BUY' && (
                  <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                    <strong>기본 전략:</strong> 기회 대기형<br/>
                    <strong>권장 설정:</strong> 기본(base) 1~2종목 | 강세장 ×1.5 | 약세장 ×0.2<br/>
                    <strong>동작:</strong> 기준을 가장 높게. 강세 확정 후 분할 진입, 약세 지속 시 현금 보유
                  </div>
                )}
              </div>
            ))}
          </Collapsible>

          <div className="card" style={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button variant="primary" onClick={saveSettings} disabled={saving}>
                {saving ? '저장 중…' : '설정 저장'}
              </Button>
              {saveStatus && (
                <span className="caption" style={{ color: saveStatus.startsWith('오류') ? COLOR_NEGATIVE : COLOR_POSITIVE }}>
                  {saveStatus}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
