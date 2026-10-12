import React from "react"
import { Rocket, Snowflake, Sprout, TrendingDown } from "lucide-react"
import { NATURE_LABELS, type SectorNature, type EconomicPhase } from "../sectorMeta"
import { NATURE_COLORS, NATURE_BG, PHASE_COLORS } from "../constants"

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="caption">-</span>
  const s = Math.round(score)
  const color = s >= 75 ? "var(--color-stock-up)" : s >= 55 ? "var(--color-brand)" : "var(--color-text-tertiary)"
  return (
    <span style={{ fontWeight: 700, color, fontSize: "var(--font-size-xl)" }}>
      {s}<span style={{ fontSize: "var(--font-size-xs)", fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 2 }}>점</span>
    </span>
  )
}

export function ChangeRate({ val }: { val: number | null }) {
  if (val == null) return <span className="muted">-</span>
  const cls = val > 0 ? "positive" : val < 0 ? "negative" : "neutral"
  return <span className={cls}>{val > 0 ? "+" : ""}{val.toFixed(2)}%</span>
}

export function NatureBadge({ nature }: { nature: SectorNature }) {
  return (
    <span className="sector-nature-badge" style={{ color: NATURE_COLORS[nature], background: NATURE_BG[nature] }}>
      {NATURE_LABELS[nature]}
    </span>
  )
}

export function PhaseIcon({ phase, size = 18 }: { phase: EconomicPhase; size?: number }) {
  const color = PHASE_COLORS[phase]
  if (phase === "recovery") return <Sprout size={size} color={color} strokeWidth={2.2} />
  if (phase === "expansion") return <Rocket size={size} color={color} strokeWidth={2.2} />
  if (phase === "slowdown") return <TrendingDown size={size} color={color} strokeWidth={2.2} />
  return <Snowflake size={size} color={color} strokeWidth={2.2} />
}
