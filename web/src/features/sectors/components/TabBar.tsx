import React from "react"
import { Compass, Layers3, Rocket, TrendingUp, type LucideIcon } from "lucide-react"
import type { Tab } from "../types"

const TAB_ITEMS: { key: Tab; label: string }[] = [
  { key: "promising", label: "상위 섹터" },
  { key: "next",      label: "다음 섹터" },
  { key: "all",       label: "전체 섹터" },
  { key: "guide",     label: "섹터 가이드" },
]

const TAB_ICON: Record<Tab, LucideIcon> = {
  promising: Compass,
  next: TrendingUp,
  all: Layers3,
  guide: Rocket,
}

export default function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (key: Tab) => void }) {
  return (
    <div className="sector-sheet__tabs" style={{ display: "flex", gap: 0, marginBottom: "var(--space-4)", borderBottom: "1px solid var(--color-border-default)" }}>
      {TAB_ITEMS.map(({ key, label }) => {
        const Icon = TAB_ICON[key]
        return (
        <button
          key={key}
          className={`sector-tab-btn${tab === key ? " sector-tab-btn--active" : ""}`}
          onClick={() => onSelect(key)}
        >
          <span className="sector-tab-btn__icon" aria-hidden>
            <Icon size={14} strokeWidth={2.2} />
          </span>
          <span className="sector-tab-btn__label">{label}</span>
        </button>
        )
      })}
    </div>
  )
}
