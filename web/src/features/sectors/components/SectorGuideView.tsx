import React from "react"
import { ArrowRight, Flame, TrendingDown, TrendingUp } from "lucide-react"
import { SECTOR_META_DATA, ROTATION_CYCLE, MACRO_SENSITIVITY, NATURE_LABELS, type SectorNature } from "../sectorMeta"
import { PHASE_COLORS, PHASE_BG } from "../constants"
import type { PhaseDetectionResult } from "../types"
import { NatureBadge, PhaseIcon } from "./badges"

export default function SectorGuideView({ detected }: { detected: PhaseDetectionResult }) {
  const activePhaseData = detected.phase ? ROTATION_CYCLE.find((p) => p.phase === detected.phase) : null

  return (
    <div className="sector-guide">

      {/* 현재 추정 국면 배너 */}
      {activePhaseData && (
        <div
          className="sector-phase-banner"
          style={{
            borderColor: PHASE_COLORS[activePhaseData.phase],
            background: PHASE_BG[activePhaseData.phase],
          }}
        >
          <div className="sector-phase-banner__left">
            <span className="sector-phase-banner__emoji" aria-hidden>
              <PhaseIcon phase={activePhaseData.phase} size={20} />
            </span>
            <div>
              <div className="sector-phase-banner__label">
                현재 추정 국면
                <span className="sector-phase-banner__phase" style={{ color: PHASE_COLORS[activePhaseData.phase] }}>
                  {activePhaseData.label}
                </span>
              </div>
              <div className="caption muted">
                {detected.basisLabel} · 판별 강도 {detected.confidence}% ({detected.confidenceLabel}) · 주도 섹터 범주: {activePhaseData.sectorCategories.join(" · ")}
              </div>
            </div>
          </div>
          <div className="caption muted sector-phase-banner__note">참고용 · 실제 국면과 다를 수 있음</div>
        </div>
      )}

      {/* 섹터 로테이션 사이클 */}
      <section className="sector-guide-section">
        <div className="sector-guide-section__head">
          <h2 className="sector-guide-section__title">섹터 로테이션 사이클</h2>
          <p className="sector-guide-section__desc">
            경기는 네 국면을 반복하며 순환합니다. 국면마다 강세를 보이는 섹터가 다르므로,
            현재 경기 위치를 파악하고 유리한 섹터로 자금을 이동하는 것이 섹터 로테이션 전략입니다.
          </p>
        </div>

        {/* 사이클 플로우 — 데스크탑 가로 */}
        <div className="rotation-flow">
          {ROTATION_CYCLE.map((phase, idx) => {
            const isActive = detected.phase === phase.phase
            return (
              <React.Fragment key={phase.phase}>
                <div
                  className={`rotation-phase-card${isActive ? " rotation-phase-card--active" : ""}`}
                  style={{
                    borderColor: PHASE_COLORS[phase.phase],
                    "--phase-color": PHASE_COLORS[phase.phase],
                    background: isActive ? PHASE_BG[phase.phase] : undefined,
                  } as React.CSSProperties}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span className="rotation-phase-card__emoji" aria-hidden>
                      <PhaseIcon phase={phase.phase} size={18} />
                    </span>
                    {isActive && <span className="rotation-phase-card__now-badge">현재</span>}
                  </div>
                  <div className="rotation-phase-card__label" style={{ color: PHASE_COLORS[phase.phase] }}>
                    {phase.label}
                  </div>
                  <p className="rotation-phase-card__desc">{phase.description}</p>
                  <div className="rotation-phase-card__sectors">
                    {phase.sectorCategories.map((sc) => (
                      <span key={sc} className="rotation-phase-card__sector-tag" style={{ color: PHASE_COLORS[phase.phase], background: PHASE_BG[phase.phase] }}>
                        {sc}
                      </span>
                    ))}
                  </div>
                  <ul className="rotation-phase-card__indicators">
                    {phase.indicators.map((ind) => (
                      <li key={ind} className="caption muted rotation-phase-card__indicator">{ind}</li>
                    ))}
                  </ul>
                </div>
                {idx < ROTATION_CYCLE.length - 1 && (
                  <div className="rotation-arrow" aria-hidden>
                    <ArrowRight size={16} />
                  </div>
                )}
                {idx === ROTATION_CYCLE.length - 1 && (
                  <div className="rotation-arrow rotation-arrow--loop" aria-hidden>
                    <ArrowRight size={16} />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>

        {/* 모바일: 수직 플로우 */}
        <div className="rotation-flow-vertical">
          {ROTATION_CYCLE.map((phase, idx) => {
            const isActive = detected.phase === phase.phase
            return (
              <div key={phase.phase} className="rotation-flow-vertical__item">
                <div className="rotation-flow-vertical__connector">
                  <div
                    className="rotation-flow-vertical__dot"
                    style={{ background: PHASE_COLORS[phase.phase], boxShadow: isActive ? `0 0 0 3px ${PHASE_BG[phase.phase]}` : undefined }}
                  />
                  {idx < ROTATION_CYCLE.length - 1 && <div className="rotation-flow-vertical__line" />}
                </div>
                <div
                  className={`rotation-phase-card rotation-phase-card--vertical${isActive ? " rotation-phase-card--active" : ""}`}
                  style={{ borderColor: PHASE_COLORS[phase.phase], background: isActive ? PHASE_BG[phase.phase] : undefined }}
                >
                  <div className="rotation-phase-card__header rotation-phase-card__header--vertical">
                    <span className="rotation-phase-card__emoji" aria-hidden>
                      <PhaseIcon phase={phase.phase} size={16} />
                    </span>
                    <span className="rotation-phase-card__label" style={{ color: PHASE_COLORS[phase.phase] }}>{phase.label}</span>
                    {isActive && <span className="rotation-phase-card__now-badge">현재</span>}
                  </div>
                  <div className="rotation-phase-card__sectors rotation-phase-card__sectors--stacked">
                    {phase.sectorCategories.map((sc) => (
                      <span key={sc} className="rotation-phase-card__sector-tag" style={{ color: PHASE_COLORS[phase.phase], background: PHASE_BG[phase.phase] }}>
                        {sc}
                      </span>
                    ))}
                  </div>
                  <p className="rotation-phase-card__desc">{phase.description}</p>
                  <ul className="rotation-phase-card__indicators rotation-phase-card__indicators--vertical">
                    {phase.indicators.map((ind) => (
                      <li key={ind} className="caption muted rotation-phase-card__indicator">{ind}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          })}
          <div className="rotation-flow-vertical__item">
            <div className="rotation-flow-vertical__connector">
              <div className="rotation-flow-vertical__dot" style={{ background: PHASE_COLORS["recovery"] }} />
            </div>
            <div className="caption muted rotation-flow-vertical__loop-note">
              <ArrowRight size={12} /> 다시 회복기로 반복
            </div>
          </div>
        </div>
      </section>

      {/* 경기민감 vs 방어주 */}
      <section className="sector-guide-section">
        <div className="sector-guide-section__head">
          <h2 className="sector-guide-section__title">섹터 성격 분류</h2>
          <p className="sector-guide-section__desc">섹터의 수익 구조와 경기/금리 민감도를 기준으로 분류한 요약입니다.</p>
        </div>
        <div className="sector-guide-nature-grid">
          {(["cyclical", "defensive", "interest_sensitive", "growth"] as SectorNature[]).map((nature) => {
            const sectors = SECTOR_META_DATA.filter((m) => m.nature === nature)
            const cats = [...new Set(sectors.map((s) => s.wicsCategory))]
            const descriptions: Record<SectorNature, string> = {
              cyclical:           "경기 확장 시 수익 급증, 수축 시 타격이 큼. 선행지표에 민감.",
              defensive:          "경기 흐름과 무관하게 안정적 수요 유지. 불황기 포트폴리오 방어.",
              interest_sensitive: "금리 방향에 수익성이 크게 좌우됨. 금리 상승 시 주목.",
              growth:             "실적보다 미래 성장 가치를 반영. 경기 호황·저금리 환경에 강함.",
            }
            return (
              <div key={nature} className="sector-guide-nature-card">
                <div className="sector-guide-nature-card__head">
                  <NatureBadge nature={nature} />
                  <span className="title-md">{NATURE_LABELS[nature]}</span>
                </div>
                <p className="muted sector-guide-nature-card__desc">{descriptions[nature]}</p>
                <div className="sector-guide-nature-card__tags">
                  {cats.map((c) => (
                    <span key={c} className="sector-guide-cat-tag">{c}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 금리·물가 민감도 */}
      <section className="sector-guide-section">
        <div className="sector-guide-section__head">
          <h2 className="sector-guide-section__title">금리 · 물가 환경별 선호 섹터</h2>
          <p className="sector-guide-section__desc">거시 환경 변화가 섹터 퍼포먼스에 미치는 방향성을 빠르게 확인할 수 있습니다.</p>
        </div>
        <div className="sector-guide-macro-grid">
          {[
            { key: "rateUp" as const,      Icon: TrendingUp,   label: "금리 상승기", color: "var(--color-stock-up)" },
            { key: "rateDown" as const,    Icon: TrendingDown, label: "금리 하락기", color: "var(--color-stock-down)" },
            { key: "inflationUp" as const, Icon: Flame,        label: "물가 상승기", color: "var(--color-orange-500)" },
          ].map(({ key, Icon, label, color }) => {
            const data = MACRO_SENSITIVITY[key]
            return (
              <div key={key} className="sector-guide-macro-card">
                <div className="sector-guide-macro-card__header">
                  <span className="sector-guide-macro-card__icon" aria-hidden>
                    <Icon size={17} color={color} strokeWidth={2.2} />
                  </span>
                  <span className="title-md" style={{ color }}>{label}</span>
                </div>
                <div className="sector-guide-macro-row">
                  <span className="sector-guide-macro-row__label positive">유리</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                    {data.favorable.map((t) => (
                      <span key={t} className="sector-guide-cat-tag sector-guide-cat-tag--positive">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="sector-guide-macro-row">
                  <span className="sector-guide-macro-row__label negative">불리</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                    {data.unfavorable.map((t) => (
                      <span key={t} className="sector-guide-cat-tag sector-guide-cat-tag--negative">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Top-Down 투자 프로세스 */}
      <section className="sector-guide-section">
        <h2 className="sector-guide-section__title">Top-Down 투자 프로세스</h2>
        <div className="sector-guide-process">
          {[
            { step: 1, title: "거시경제 분석",       desc: "GDP 성장률·금리 방향·인플레이션·환율 등 거시지표로 현재 경기 국면을 파악합니다." },
            { step: 2, title: "경기 국면 판단",       desc: "회복기·호황기·둔화기·침체기 중 어디에 있는지 확인합니다. ISM 제조업 지수, 장단기금리차, 실업률을 참고합니다." },
            { step: 3, title: "유리한 섹터 선별",     desc: "현재 국면에서 아웃퍼폼 가능성이 높은 섹터를 위 가이드를 참고해 선별합니다." },
            { step: 4, title: "섹터 ETF·종목 선정",  desc: "'상위 섹터' 탭에서 점수 상위 섹터를 확인하고, 대장주 TOP 3에서 구체적 종목을 검토합니다." },
            { step: 5, title: "3~6개월 단위 재조정", desc: "경기 국면이 변화하면 섹터 비중을 재조정합니다. 단기 매매보다 국면 전환 타이밍에 집중합니다." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="sector-guide-process-step">
              <div className="sector-guide-process-step__num">{step}</div>
              <div>
                <div className="sector-guide-process-step__title">{title}</div>
                <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
