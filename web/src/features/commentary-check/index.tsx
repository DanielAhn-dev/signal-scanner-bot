import More from '../../components/ui/More'
import { COMMENTARY, claimView, commentaryStale, type CommentaryClaim } from '../../lib/commentaryCheck'

const BAR_MAX_PCT = 50

function Bar({ label, pct, strong }: { label: string; pct: number; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 92, color: 'var(--color-text-secondary)' }}>{label}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--color-bg-secondary)' }}>
        <div
          style={{
            width: `${Math.min(100, (pct / BAR_MAX_PCT) * 100)}%`,
            height: '100%',
            borderRadius: 4,
            background: strong ? 'var(--color-warning)' : 'var(--color-text-tertiary)',
          }}
        />
      </div>
      <span style={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</span>
    </div>
  )
}

function ClaimCard({ claim }: { claim: CommentaryClaim }) {
  const v = claimView(claim)
  return (
    <section
      aria-label={claim.short}
      style={{ margin: '0 0 var(--space-3, 12px)', padding: '12px 14px', border: '1px solid var(--color-border-default)', borderRadius: 8, lineHeight: 1.55, wordBreak: 'keep-all' }}
    >
      <div style={{ fontWeight: 700 }}>“{claim.quote}”</div>
      <div
        style={{
          display: 'inline-block',
          margin: '6px 0 8px',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 12,
          background: v.tone === 'caution' ? 'var(--color-warning-bg)' : 'var(--color-bg-secondary)',
          color: v.tone === 'caution' ? 'var(--color-warning)' : 'var(--color-text-secondary)',
        }}
      >
        {v.headline}
      </div>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{v.mainLine}</div>
      <Bar label="신호가 켜진 뒤" pct={claim.rateOnPct} strong />
      <Bar label="그렇지 않은 때" pct={claim.rateOffPct} />
      <div className="caption muted" style={{ marginTop: 6 }}>{v.subLine}</div>
      <More label="자세히 보기">
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {v.detailLines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </More>
    </section>
  )
}

/** 시장 공부 > 해설 점검 — 방송·유튜브에서 자주 듣는 말이 과거 자료에서 먼저 알려 주는 신호였는지 (H72) */
export default function CommentaryCheckPage() {
  const stale = commentaryStale()
  return (
    <section className="container-app" style={{ maxWidth: 720 }}>
      <div className="title-md" style={{ marginBottom: 4 }}>해설 점검</div>
      <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        방송이나 유튜브에서 “이럴 땐 이렇습니다”라고 자주 말하는 8가지를 과거 자료로 확인했어요.
        사거나 팔라는 신호가 아니라, <strong>그 말을 듣고 서둘러 움직일 근거가 있었는지</strong> 보는 참고 자료예요.
      </p>
      <More label="이 화면을 읽는 법">
        <div className="caption" style={{ lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          <div>확인한 것: {COMMENTARY.outcome}</div>
          <div>방법: {COMMENTARY.market}, {COMMENTARY.method}</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {COMMENTARY.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </More>
      <div style={{ height: 'var(--space-3, 12px)' }} />
      {COMMENTARY.claims.map((c) => <ClaimCard key={c.id} claim={c} />)}
      <div className="caption muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
        생성일 {COMMENTARY.generated} · {COMMENTARY.script}
        {stale && ' · ⚠️ 자료를 만든 지 6개월이 넘었어요. 다시 확인이 필요합니다.'}
      </div>
    </section>
  )
}
