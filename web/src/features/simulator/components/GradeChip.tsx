import React from 'react'
import type { TradeGrade } from '../telegramFormat'

export default function GradeChip({ grade }: { grade: TradeGrade }) {
  const cls =
    grade === 'A' ? 'sim-grade-a'
    : grade === 'B' ? 'sim-grade-b'
    : grade === 'C' ? 'sim-grade-c'
    : 'sim-grade-d'
  return <span className={`sim-grade-chip ${cls}`}>{grade}</span>
}
