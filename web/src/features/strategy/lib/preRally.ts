export function getPreRallyBadge(input: { lift: number; win: number; mdd: number }): { label: string; color: string } {
  if (input.lift >= 5 && input.win >= 45) return { label: '추천', color: 'var(--color-success)' }
  if (input.mdd <= -15 || input.lift < 0) return { label: '주의', color: 'var(--color-warning)' }
  return { label: '관찰', color: 'var(--color-brand)' }
}
