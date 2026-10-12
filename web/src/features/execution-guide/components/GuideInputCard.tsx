import React from 'react'
import { formatKstDateTime } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Detail from '../../../components/ui/Detail'
import type { RiskMode } from '../types'

export type GuideInputCardProps = {
  codesText: string
  setCodesText: React.Dispatch<React.SetStateAction<string>>
  capital: string
  setCapital: (value: string) => void
  maxWeightPct: string
  setMaxWeightPct: React.Dispatch<React.SetStateAction<string>>
  splitCount: string
  setSplitCount: React.Dispatch<React.SetStateAction<string>>
  riskMode: RiskMode
  setRiskMode: React.Dispatch<React.SetStateAction<RiskMode>>
  sourceLabel: string
  setSourceLabel: React.Dispatch<React.SetStateAction<string>>
  includeNews: boolean
  setIncludeNews: React.Dispatch<React.SetStateAction<boolean>>
  loading: boolean
  generatedAt: string | null
  compactViewChoice: boolean
  setCompactView: React.Dispatch<React.SetStateAction<boolean>>
  codeList: string[]
  buildGuide: () => void | Promise<void>
}

export default function GuideInputCard({
  codesText,
  setCodesText,
  capital,
  setCapital,
  maxWeightPct,
  setMaxWeightPct,
  splitCount,
  setSplitCount,
  riskMode,
  setRiskMode,
  sourceLabel,
  setSourceLabel,
  includeNews,
  setIncludeNews,
  loading,
  generatedAt,
  compactViewChoice,
  setCompactView,
  codeList,
  buildGuide,
}: GuideInputCardProps) {
  return (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <div className="title-md">매매 계획 만들기</div>
      <div className="caption" style={{ marginTop: 4 }}>종목 코드를 입력하고 가이드 생성을 누르면 진입/손절/목표 계획이 만들어집니다.</div>

      <div className="execution-guide-form-block" style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
        <Input
          label="종목 코드(쉼표/공백 구분)"
          textarea
          value={codesText}
          onChange={(e) => setCodesText(e.target.value)}
          placeholder="005930, 000660, 272210"
        />

        <div className="execution-guide-form-grid" style={{ display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Input label="총 투자금" value={capital} onChange={(e) => setCapital(e.target.value)} />
          <Input label="종목당 최대 비중(%)" value={maxWeightPct} onChange={(e) => setMaxWeightPct(e.target.value)} />
          <Input label="분할 횟수(권장 3~5)" value={splitCount} onChange={(e) => setSplitCount(e.target.value)} />
          <div className="ui-field">
            <label className="ui-label">리스크 모드</label>
            <select className="ui-input ui-text" value={riskMode} onChange={(e) => setRiskMode(e.target.value as RiskMode)}>
              <option value="conservative">보수</option>
              <option value="neutral">중립</option>
              <option value="aggressive">공격</option>
            </select>
          </div>
          <Detail><Input label="추천 출처" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} /></Detail>
          <div className="ui-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={buildGuide} disabled={loading || codeList.length === 0} style={{ width: '100%', minHeight: 38 }}>
              {loading ? '가이드 생성 중…' : '가이드 생성'}
            </Button>
          </div>
        </div>
      </div>

      <div className="execution-guide-meta-row" style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Detail>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={includeNews} onChange={(e) => setIncludeNews(e.target.checked)} />
            뉴스 상위 3건 요약 포함
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={compactViewChoice} onChange={(e) => setCompactView(e.target.checked)} />
            핵심만 보기
          </label>
        </Detail>
        <span className="caption">코드 {codeList.length}개</span>
        {generatedAt && <span className="caption">생성시각 {formatKstDateTime(generatedAt)}</span>}
      </div>

      {codeList.length > 0 && (
        <div className="execution-guide-code-chip-row" style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {codeList.slice(0, 12).map((code) => (
            <span key={code} className="scan-grade-badge scan-grade-b" style={{ fontSize: 11 }}>
              {code}
            </span>
          ))}
          {codeList.length > 12 && <span className="caption">외 {codeList.length - 12}개</span>}
        </div>
      )}
    </div>
  )
}
