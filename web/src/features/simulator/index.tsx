import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCurrentChatId } from '../../stores/profileStore'
import { formatKrw } from '../../lib/format'
import { useToast } from '../../components/ToastProvider'
import StockDetailModal from '../../components/StockDetailModal'
import { useCandidates } from './hooks/useCandidates'
import { usePlanSync } from './hooks/usePlanSync'
import { useRecommendation } from './hooks/useRecommendation'
import { useSimulatorPlan } from './hooks/useSimulatorPlan'
import { useStockSearch } from './hooks/useStockSearch'
import SummaryCard from './components/SummaryCard'
import RecommendSection from './components/RecommendSection'
import SettingsPanel from './components/SettingsPanel'
import ItemsSection from './components/ItemsSection'
import GoalPathSection from './components/GoalPathSection'
import ScenarioSection from './components/ScenarioSection'

export default function SimulatorPage() {
  const chatId = useCurrentChatId()
  const location = useLocation()
  const navigate = useNavigate()
  const proposedCapital = Number((location.state as { seedBuilderCapital?: number } | null)?.seedBuilderCapital)
  const fromSeedBuilder = Number.isSafeInteger(proposedCapital) && proposedCapital > 0
  const toast = useToast()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showStockDetail, setShowStockDetail] = useState(false)
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [selectedStockName, setSelectedStockName] = useState<string>('')

  // 훅 호출 순서 = 효과 실행 순서: 시드 반영 → 검색 디바운스 → 후보 조회 → 추천 재계산 → 서버 계획 불러오기
  const {
    initialPlan, totalCapital, setTotalCapital, items, setItems, monthlyProfitTarget, setMonthlyProfitTarget,
    fillRatePct, setFillRatePct, feePct, setFeePct, taxPct, setTaxPct, memo, setMemo, expandedIdx, setExpandedIdx,
    summary, scenarioRows, itemMeta, statusMeta, weeklyPlan, updateItem, appendRow, removeRow,
  } = useSimulatorPlan({ fromSeedBuilder, proposedCapital })
  const { addSearch, setAddSearch, addResults, setAddResults, setAddFocused, addWrapRef, showAddDropdown } = useStockSearch()
  const {
    watchlistCandidates, algoCandidates, loadingAlgo, loadingWatchlist, loadingCandidates,
    loadWatchlistCandidates, loadAlgoCandidates,
  } = useCandidates(chatId)
  const {
    recommendedPortfolio, showRecommendation, setShowRecommendation, recommendSource, setRecommendSource,
    recommendStyle, setRecommendStyle, compareResult, showCompare, setShowCompare,
    generateRecommendation, applyRecommendation, generateCompare,
  } = useRecommendation({ chatId, items, setItems, totalCapital, monthlyProfitTarget, algoCandidates, watchlistCandidates, toast })
  const {
    syncing, lastServerSavedAt, telegramFormat, setTelegramFormat, history, historyOpen, setHistoryOpen, historyLoading,
    saveLocal, saveServer, loadServer, sendTelegram, loadHistory, loadFromHistory,
  } = usePlanSync({
    chatId, toast, fromSeedBuilder, initialPlan, totalCapital, setTotalCapital, memo, setMemo, items, setItems,
    setExpandedIdx, fillRatePct, feePct, taxPct, summary,
  })

  const addRow = (stock?: { code: string; name: string }) => {
    appendRow(stock)
    setAddSearch('')
    setAddResults([])
  }

  return (
    <div className="sim-page">
      {fromSeedBuilder && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-sunken)', fontSize: 13 }}>
          <span>이번 달 투자금에서 확인한 가용 현금 {formatKrw(proposedCapital)}으로 시작했습니다. 저장된 계획과 가상 시드는 바뀌지 않았습니다.</span>
          <button type="button" onClick={() => navigate('/seed-builder')} style={{ border: 0, background: 'none', color: 'var(--color-brand)', cursor: 'pointer', font: 'inherit', padding: 0 }}>이번 달 투자금로 돌아가기</button>
        </div>
      )}
      {/* ── 헤더 ── */}
      <div className="sim-header">
        <div>
          <h1 className="sim-title">시뮬레이터</h1>
          <p className="sim-desc">넣을 돈과 종목을 정하면, 잘 풀릴 때와 안 풀릴 때 얼마가 되는지 미리 보여줍니다.</p>
          <p className="sim-desc" style={{ marginTop: 4 }}>
            ① 총 투자금 입력 → ② 종목 추가(고르기 어려우면 아래 "종목 추천받기") → ③ 맨 아래 시나리오 분석 확인
          </p>
        </div>
        <button className="sim-settings-btn" onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
          설정
        </button>
      </div>

      {/* ── 요약 카드 ── */}
      <SummaryCard
        totalCapital={totalCapital}
        setTotalCapital={setTotalCapital}
        summary={summary}
      />

      {/* ── 월 수익 목표 & 추천 ── */}
      <RecommendSection
        totalCapital={totalCapital}
        items={items}
        setItems={setItems}
        monthlyProfitTarget={monthlyProfitTarget}
        setMonthlyProfitTarget={setMonthlyProfitTarget}
        feePct={feePct}
        taxPct={taxPct}
        recommendedPortfolio={recommendedPortfolio}
        showRecommendation={showRecommendation}
        setShowRecommendation={setShowRecommendation}
        watchlistCandidates={watchlistCandidates}
        algoCandidates={algoCandidates}
        loadingAlgo={loadingAlgo}
        loadingWatchlist={loadingWatchlist}
        loadingCandidates={loadingCandidates}
        recommendSource={recommendSource}
        setRecommendSource={setRecommendSource}
        recommendStyle={recommendStyle}
        setRecommendStyle={setRecommendStyle}
        compareResult={compareResult}
        showCompare={showCompare}
        setShowCompare={setShowCompare}
        setShowStockDetail={setShowStockDetail}
        setSelectedStockCode={setSelectedStockCode}
        setSelectedStockName={setSelectedStockName}
        toast={toast}
        chatId={chatId}
        generateRecommendation={generateRecommendation}
        applyRecommendation={applyRecommendation}
        generateCompare={generateCompare}
        loadWatchlistCandidates={loadWatchlistCandidates}
        loadAlgoCandidates={loadAlgoCandidates}
      />

      {/* ── 설정 패널 (접기/펼치기) ── */}
      {settingsOpen && (
        <SettingsPanel
          totalCapital={totalCapital}
          setTotalCapital={setTotalCapital}
          fillRatePct={fillRatePct}
          setFillRatePct={setFillRatePct}
          feePct={feePct}
          setFeePct={setFeePct}
          taxPct={taxPct}
          setTaxPct={setTaxPct}
          memo={memo}
          setMemo={setMemo}
          syncing={syncing}
          lastServerSavedAt={lastServerSavedAt}
          telegramFormat={telegramFormat}
          setTelegramFormat={setTelegramFormat}
          history={history}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyLoading={historyLoading}
          saveLocal={saveLocal}
          saveServer={saveServer}
          loadServer={loadServer}
          sendTelegram={sendTelegram}
          loadHistory={loadHistory}
          loadFromHistory={loadFromHistory}
        />
      )}

      {/* ── 종목 목록 ── */}
      <ItemsSection
        totalCapital={totalCapital}
        items={items}
        expandedIdx={expandedIdx}
        setExpandedIdx={setExpandedIdx}
        addSearch={addSearch}
        setAddSearch={setAddSearch}
        addResults={addResults}
        setAddResults={setAddResults}
        setAddFocused={setAddFocused}
        addWrapRef={addWrapRef}
        itemMeta={itemMeta}
        statusMeta={statusMeta}
        updateItem={updateItem}
        addRow={addRow}
        removeRow={removeRow}
        showAddDropdown={showAddDropdown}
      />

      {/* ── 목표 달성 경로 ── */}
      <GoalPathSection
        items={items}
        monthlyProfitTarget={monthlyProfitTarget}
        weeklyPlan={weeklyPlan}
      />

      {/* ── 시나리오 분석 ── */}
      {items.length > 0 && (
        <ScenarioSection
          summary={summary}
          scenarioRows={scenarioRows}
        />
      )}

      {/* 시세 상세 모달 */}
      <StockDetailModal
        code={selectedStockCode}
        name={selectedStockName}
        isOpen={showStockDetail}
        onClose={() => {
          setShowStockDetail(false)
          setSelectedStockCode('')
          setSelectedStockName('')
        }}
      />
    </div>
  )
}
