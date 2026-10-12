import React from 'react'
import { formatKrw, formatKstDateTime } from '../../../lib/format'
import NumInput from './NumInput'
import { clampPercent, type TelegramFormat } from '../telegramFormat'
import type { PlanHistoryEntry } from '../types'

export type SettingsPanelProps = {
  totalCapital: number
  setTotalCapital: React.Dispatch<React.SetStateAction<number>>
  fillRatePct: number
  setFillRatePct: React.Dispatch<React.SetStateAction<number>>
  feePct: number
  setFeePct: React.Dispatch<React.SetStateAction<number>>
  taxPct: number
  setTaxPct: React.Dispatch<React.SetStateAction<number>>
  memo: string
  setMemo: React.Dispatch<React.SetStateAction<string>>
  syncing: boolean
  lastServerSavedAt: string
  telegramFormat: TelegramFormat
  setTelegramFormat: React.Dispatch<React.SetStateAction<TelegramFormat>>
  history: PlanHistoryEntry[]
  historyOpen: boolean
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  historyLoading: boolean
  saveLocal: () => void
  saveServer: () => void | Promise<void>
  loadServer: () => void | Promise<void>
  sendTelegram: () => void | Promise<void>
  loadHistory: () => void | Promise<void>
  loadFromHistory: (entry: PlanHistoryEntry) => void
}

export default function SettingsPanel({
  totalCapital,
  setTotalCapital,
  fillRatePct,
  setFillRatePct,
  feePct,
  setFeePct,
  taxPct,
  setTaxPct,
  memo,
  setMemo,
  syncing,
  lastServerSavedAt,
  telegramFormat,
  setTelegramFormat,
  history,
  historyOpen,
  setHistoryOpen,
  historyLoading,
  saveLocal,
  saveServer,
  loadServer,
  sendTelegram,
  loadHistory,
  loadFromHistory,
}: SettingsPanelProps) {
  return (
    <div className="sim-settings-panel">
      <div className="sim-settings-grid">
        <div className="sim-input-group">
          <label className="sim-input-label">총 투자금 (원)</label>
          <div className="sim-input-row">
            <input className="sim-input" type="number" min={0} value={totalCapital}
              onChange={(e) => setTotalCapital(Math.max(0, Number(e.target.value || 0)))} />
          </div>
        </div>
        <NumInput label="체결률 (%)" value={fillRatePct} suffix="%"
          onChange={(v) => setFillRatePct(clampPercent(v, 0, 100))} min={0} max={100} />
        <NumInput label="수수료율 (%)" value={feePct} suffix="%" step={0.01}
          onChange={(v) => setFeePct(Math.max(0, v))} min={0} />
        <NumInput label="세금/기타 (%)" value={taxPct} suffix="%" step={0.01}
          onChange={(v) => setTaxPct(Math.max(0, v))} min={0} />
      </div>

      <div className="sim-input-group sim-input-group--full">
        <label className="sim-input-label">메모</label>
        <input className="sim-input" value={memo} onChange={(e) => setMemo(e.target.value)}
          placeholder="예: 장 초반 변동성 높음, 2차까지만 체결 예상" />
      </div>

      {lastServerSavedAt && (
        <p className="sim-saved-at">서버 저장: {formatKstDateTime(lastServerSavedAt)}</p>
      )}

      <div className="sim-settings-actions">
        <button className="sim-btn sim-btn--ghost" onClick={saveLocal} disabled={syncing}>로컬 저장</button>
        <button className="sim-btn sim-btn--ghost" onClick={loadServer} disabled={syncing}>서버 불러오기</button>
        <button className="sim-btn sim-btn--ghost" onClick={loadHistory} disabled={syncing || historyLoading}>
          히스토리
        </button>
        <button className="sim-btn sim-btn--primary" onClick={saveServer} disabled={syncing}>서버 저장</button>
        <div className="sim-telegram-wrap">
          <select className="sim-select" value={telegramFormat}
            onChange={(e) => setTelegramFormat(e.target.value as TelegramFormat)}>
            <option value="simple">간단</option>
            <option value="detailed">상세</option>
          </select>
          <button className="sim-btn sim-btn--ghost" onClick={sendTelegram} disabled={syncing}>텔레그램 전송</button>
        </div>
      </div>

      {/* 히스토리 */}
      {historyOpen && (
        <div className="sim-history">
          <div className="sim-history-head">
            <span className="sim-section-label">저장 히스토리</span>
            <button className="sim-btn sim-btn--ghost" onClick={() => setHistoryOpen(false)}>닫기</button>
          </div>
          {history.length === 0
            ? <p className="sim-empty-text">저장된 히스토리가 없습니다.</p>
            : history.map((entry, i) => {
              const p = entry.plan
              const cap = p?.totalCapital ? formatKrw(Number(p.totalCapital)) : '-'
              const cnt = Array.isArray(p?.items) ? p.items.length : 0
              return (
                <button key={i} className="sim-history-row" onClick={() => loadFromHistory(entry)}>
                  <div>
                    <div className="sim-history-date">{formatKstDateTime(entry.updatedAt)}</div>
                    <div className="sim-history-meta">{cap} · {cnt}개 종목{p?.notes ? ` · ${String(p.notes).slice(0, 30)}` : ''}</div>
                  </div>
                  <span className="sim-history-load">불러오기 →</span>
                </button>
              )
            })
          }
        </div>
      )}
    </div>
  )
}
