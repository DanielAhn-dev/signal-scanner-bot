import React, { useState } from 'react'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import { useDetailed } from '../../stores/viewModeStore'
import { useToast } from '../../components/ToastProvider'
import { useCurrentChatId } from '../../stores/profileStore'
import GuideInputCard from './components/GuideInputCard'
import AutoFinderCard from './components/AutoFinderCard'
import GuideTable from './components/GuideTable'
import GuideActions from './components/GuideActions'
import { useAutoCandidates } from './hooks/useAutoCandidates'
import { useGuideBuild } from './hooks/useGuideBuild'
import { useGuideInputs } from './hooks/useGuideInputs'
import { useGuideShare } from './hooks/useGuideShare'

export default function ExecutionGuidePage() {
  const chatId = useCurrentChatId()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [compactViewChoice, setCompactView] = useState(false)
  const detailed = useDetailed()
  // 간단히 보기에서는 핵심(진입·손절·목표·수량)만 보인다
  const compactView = compactViewChoice || !detailed

  // 훅 호출 순서 = 효과 실행 순서: 이어받기·시드 반영 → (자동 후보) → 이어받은 종목 자동 생성
  const {
    codesText, setCodesText, capital, setCapital, maxWeightPct, setMaxWeightPct, splitCount, setSplitCount,
    riskMode, setRiskMode, sourceLabel, setSourceLabel, includeNews, setIncludeNews,
    hydratedByPending, setHydratedByPending, codeList, totalCapital, capitalReady,
  } = useGuideInputs()
  const {
    autoCandidates, setAutoCandidates, autoLoading, autoError, candidateMode, setCandidateMode,
    scoreVersion, setScoreVersion, showAutoFinder, setShowAutoFinder, visibleAutoCandidates,
    fetchAutoCandidates, loadAutoCandidates, useAutoCandidatesAsCodes,
  } = useAutoCandidates({ codeList, setCodesText, setSourceLabel, setError })
  const {
    loading, rows, generatedAt, setGeneratedAt, snapshotReady, setSnapshotReady, lastSnapshotAt, setLastSnapshotAt,
    persistGuideSnapshot, buildGuide, totalPlanned,
  } = useGuideBuild({
    chatId, codeList, setCodesText, capital, maxWeightPct, splitCount, riskMode, includeNews, sourceLabel, setSourceLabel,
    hydratedByPending, capitalReady, setHydratedByPending, autoCandidates, setAutoCandidates, visibleAutoCandidates, fetchAutoCandidates,
    candidateMode, scoreVersion, setError,
  })
  const { shareManager, pdfLoading, openExecutionGuideShare, openExecutionGuideShareManager, downloadExecutionGuidePdf } = useGuideShare({
    chatId, toast, rows, codeList, generatedAt, setGeneratedAt, snapshotReady, setSnapshotReady, setLastSnapshotAt,
    persistGuideSnapshot, setError,
  })

  return (
    <section className="xls-page-inset">
      <div className="xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '360px' }}>
        <table className="xls-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
          <tbody>
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" style={{ padding: '8px 10px' }}>
                <SheetHeaderBar
                  title="실행 가이드"
                  subtitle="종목을 직접 고르지 않아도, 스캔/집행우선 데이터에서 수급·추세·유동성 중심의 자동 후보를 찾아 진입·청산 계획으로 변환합니다."
                  action={<EconomicEventBadge />}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="execution-guide-page" style={{ display: 'grid', gap: 'var(--space-3)' }}>

      <GuideInputCard
        codesText={codesText}
        setCodesText={setCodesText}
        capital={capital}
        setCapital={setCapital}
        maxWeightPct={maxWeightPct}
        setMaxWeightPct={setMaxWeightPct}
        splitCount={splitCount}
        setSplitCount={setSplitCount}
        riskMode={riskMode}
        setRiskMode={setRiskMode}
        sourceLabel={sourceLabel}
        setSourceLabel={setSourceLabel}
        includeNews={includeNews}
        setIncludeNews={setIncludeNews}
        loading={loading}
        generatedAt={generatedAt}
        compactViewChoice={compactViewChoice}
        setCompactView={setCompactView}
        codeList={codeList}
        buildGuide={buildGuide}
      />

      <AutoFinderCard
        codesText={codesText}
        setCodesText={setCodesText}
        setSourceLabel={setSourceLabel}
        autoCandidates={autoCandidates}
        autoLoading={autoLoading}
        autoError={autoError}
        candidateMode={candidateMode}
        setCandidateMode={setCandidateMode}
        scoreVersion={scoreVersion}
        setScoreVersion={setScoreVersion}
        showAutoFinder={showAutoFinder}
        setShowAutoFinder={setShowAutoFinder}
        visibleAutoCandidates={visibleAutoCandidates}
        loadAutoCandidates={loadAutoCandidates}
        useAutoCandidatesAsCodes={useAutoCandidatesAsCodes}
      />

      {error && <div className="card" style={{ color: 'var(--color-error)' }}>{error}</div>}

      <GuideTable
        loading={loading}
        rows={rows}
        compactView={compactView}
      />

      <GuideActions
        sourceLabel={sourceLabel}
        rows={rows}
        snapshotReady={snapshotReady}
        lastSnapshotAt={lastSnapshotAt}
        pdfLoading={pdfLoading}
        shareManager={shareManager}
        openExecutionGuideShare={openExecutionGuideShare}
        openExecutionGuideShareManager={openExecutionGuideShareManager}
        downloadExecutionGuidePdf={downloadExecutionGuidePdf}
        totalPlanned={totalPlanned}
        totalCapital={totalCapital}
      />
      </section>
    </section>
  )
}
