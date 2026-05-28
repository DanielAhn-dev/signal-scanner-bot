import type { DailyCandidateForecast } from './marketInsightService'

export const HTML_BODY_PREFIX = '__HTML__\n'

export function topicLabel(topic: string): string {
  if (topic === '주간') return '주간'
  if (topic === '눌림목') return '눌림목'
  if (topic === '포트폴리오') return '포트폴리오'
  if (topic === '관심종목') return '관심종목'
  if (topic === '거시') return '거시'
  if (topic === '수급') return '수급'
  if (topic === '섹터') return '섹터'
  if (topic === '확신추천') return '집행우선 종목'
  if (topic === '공개추천') return '공개추천'
  if (topic === '가이드') return '운영 가이드'
  if (topic === '자동매매') return '자동매매 가이드'
  return '추천'
}

export function topicTitle(topic: string): string {
  if (topic === '주간') return '주간 증시 리포트'
  if (topic === '눌림목') return '다음 주 눌림목 리포트'
  if (topic === '포트폴리오') return '보유 포트폴리오 리포트'
  if (topic === '관심종목') return '관심종목 리포트'
  if (topic === '거시') return '거시 지표 리포트'
  if (topic === '수급') return '수급 리포트'
  if (topic === '섹터') return '섹터 리포트'
  if (topic === '확신추천') return '집행우선 종목 리포트'
  if (topic === '공개추천') return '공유용 오늘의 투자 후보 리포트'
  if (topic === '가이드') return 'Signal Scanner Bot 운영 가이드'
  if (topic === '자동매매') return '자동매매 명령어 운영 가이드'
  return '오늘의 투자 후보 리포트'
}

export function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function restoreAllowedInlineTags(escaped: string): string {
  return escaped.replace(/&lt;(\/)?(b|strong|i|em|code|u|s)&gt;/gi, '<$1$2>')
}

function renderLine(line: string): string {
  return restoreAllowedInlineTags(escapeHtml(line))
}

/**
 * Converts Telegram-formatted plain text to readable HTML.
 * Handles headings (<b>…</b> on its own line), hr (─── lines),
 * ordered/unordered lists, and indented continuation lines.
 */
export function toRichHtml(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return '<p>표시할 내용이 없습니다.</p>'

  const lines = normalized.split('\n').map((line) => line.trimEnd())
  const out: string[] = []
  let inParagraph = false
  let inUl = false
  let inOl = false
  let lastWasListItem = false

  const closeParagraph = () => {
    if (inParagraph) {
      out.push('</p>')
      inParagraph = false
    }
  }
  const closeLists = () => {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
    lastWasListItem = false
  }
  const closeAll = () => {
    closeParagraph()
    closeLists()
  }

  for (const raw of lines) {
    const line = raw.trim()

    if (!line) {
      closeAll()
      continue
    }

    // Indented continuation lines (≥2 leading spaces) inside a list item
    if (raw.match(/^ {2,}/) && (inOl || inUl) && lastWasListItem && out.length > 0) {
      const last = out[out.length - 1]
      if (last && last.startsWith('<li>') && last.endsWith('</li>')) {
        out[out.length - 1] = last.slice(0, -5) + '<br />' + renderLine(line) + '</li>'
        continue
      }
    }

    if (/^[-─]{5,}$/.test(line)) {
      closeAll()
      out.push('<hr />')
      continue
    }

    const heading = line.match(/^<b>(.+)<\/b>$/i)
    if (heading) {
      closeAll()
      out.push(`<h2>${renderLine(heading[1])}</h2>`)
      lastWasListItem = false
      continue
    }

    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      closeParagraph()
      if (!inOl) {
        if (inUl) { out.push('</ul>'); inUl = false }
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${renderLine(ol[1])}</li>`)
      lastWasListItem = true
      continue
    }

    const ul = line.match(/^[•·]\s+(.+)$/)
    if (ul) {
      closeParagraph()
      if (!inUl) {
        if (inOl) { out.push('</ol>'); inOl = false }
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${renderLine(ul[1])}</li>`)
      lastWasListItem = true
      continue
    }

    lastWasListItem = false
    closeLists()
    if (!inParagraph) {
      out.push('<p>')
      inParagraph = true
      out.push(renderLine(line))
    } else {
      out.push('<br />')
      out.push(renderLine(line))
    }
  }

  closeAll()

  const html = out.join('') || '<p>표시할 내용이 없습니다.</p>'
  const chunks = html.split(/(?=<h2>)/g).map((chunk) => chunk.trim()).filter(Boolean)
  if (!chunks.length) return '<section class="report-section"><p>표시할 내용이 없습니다.</p></section>'
  return chunks
    .map((chunk) => `<section class="report-section">${chunk}</section>`)
    .join('')
}

export function toPreHtml(text: string): string {
  return `<pre>${escapeHtml(text || '')}</pre>`
}

/**
 * Returns the body content HTML, handling pre-rendered HTML with HTML_BODY_PREFIX.
 * Use this instead of calling toRichHtml() directly.
 */
export function renderBodyText(bodyText: string): string {
  if (bodyText.startsWith(HTML_BODY_PREFIX)) {
    return `<div class="rich-share rich-share--html">${bodyText.slice(HTML_BODY_PREFIX.length)}</div>`
  }
  return `<div class="rich-share rich-share--text">${toRichHtml(bodyText)}</div>`
}

// ─── Conviction (하이라이트 종목 추천) Web HTML Builder ───────────────────────

// 모든 카드 동일한 중립 스타일 — 순위 배지만 1위는 브랜드 블루, 나머지 그레이
const CONVICTION_RANK_BADGE = ['#0060FF', '#8B95A1', '#8B95A1', '#8B95A1', '#8B95A1'] as const

function convictionConfidenceLevel(pct: number): { label: string; color: string } {
  if (pct >= 78) return { label: '높음', color: '#007B5F' }
  if (pct >= 65) return { label: '보통', color: '#C85700' }
  return { label: '낮음', color: '#F04452' }
}

function convictionScoreBar(score: number, colorHigh: string): string {
  const w = Math.min(100, Math.max(0, score))
  const fill = score >= 70 ? colorHigh : score >= 50 ? '#FF8A00' : '#8B95A1'
  return `<div style="flex:1;background:#E5E8EB;border-radius:3px;height:5px;overflow:hidden"><div style="width:${w}%;height:100%;background:${fill};border-radius:3px"></div></div>`
}

type StrategyInfo = { description: string }

function convictionStrategyInfo(label: string): StrategyInfo {
  const map: Record<string, StrategyInfo> = {
    '눌림분할': {
      description: '상승 흐름 내 단기 조정 구간에서 분할 진입하는 전략으로, 평균 단가를 낮춰 리스크 대비 기대 수익을 높입니다.',
    },
    '추세분할': {
      description: '정배열 상승 추세를 확인한 후 분할 진입하는 전략으로, 추세 지속 가능성이 높고 추격 위험을 최소화합니다.',
    },
    '지지매수': {
      description: '주요 지지선에서 반등을 노리는 전략으로, 하방이 제한된 구간에서 손절 기준이 명확합니다.',
    },
    '확인매수': {
      description: '기술·밸류·안전 지표가 기준을 모두 통과한 후 진입하는 전략으로, 시그널이 명확할 때만 포지션을 잡습니다.',
    },
  }
  return map[label] ?? { description: '복합 지표 기반으로 선별된 진입 전략입니다.' }
}

function convictionRationalePoints(item: DailyCandidateForecast): string[] {
  const points: string[] = []
  const edge = item.expectedUpsidePct - item.expectedDrawdownPct
  const strat = convictionStrategyInfo(item.strategyLabel)
  points.push(strat.description)

  if (item.scoreComponents.momentum >= 75) {
    points.push(`모멘텀 ${item.scoreComponents.momentum.toFixed(0)}점 — 강한 상승 추세가 지속되고 있어 추가 상승 여력이 충분합니다.`)
  } else if (item.scoreComponents.momentum >= 60) {
    points.push(`모멘텀 ${item.scoreComponents.momentum.toFixed(0)}점 — 우상향 방향성이 유지되고 있습니다.`)
  } else {
    points.push(`모멘텀 ${item.scoreComponents.momentum.toFixed(0)}점 — 현재 추세를 재확인한 후 진입 타이밍을 잡으세요.`)
  }

  if (item.scoreComponents.value >= 70) {
    points.push(`밸류 ${item.scoreComponents.value.toFixed(0)}점 — 내재가치 대비 저평가 구간으로 상승 여력이 풍부합니다.`)
  } else if (item.scoreComponents.value >= 55) {
    points.push(`밸류 ${item.scoreComponents.value.toFixed(0)}점 — 적정 밸류에이션 수준으로 과열 부담이 없습니다.`)
  }

  if (item.scoreComponents.safety >= 72) {
    points.push(`안전성 ${item.scoreComponents.safety.toFixed(0)}점 — 하방 리스크가 제한적이고 변동성이 안정적입니다.`)
  } else if (item.scoreComponents.safety >= 55) {
    points.push(`안전성 ${item.scoreComponents.safety.toFixed(0)}점 — 기본 리스크 관리 조건을 충족합니다.`)
  } else {
    points.push(`안전성 ${item.scoreComponents.safety.toFixed(0)}점 — 변동성이 있어 진입 비중을 줄이고 분할 매수를 권장합니다.`)
  }

  if (edge >= 8) {
    points.push(`기대 여지 +${edge.toFixed(1)}% — 예상 손실 대비 기대 수익 비율(손익비)이 우수합니다.`)
  } else if (edge >= 5) {
    points.push(`기대 여지 +${edge.toFixed(1)}% — 리스크 대비 적절한 수익 기대치로 진입 매력이 있습니다.`)
  } else {
    points.push(`기대 여지 +${edge.toFixed(1)}% — 손익비가 낮으므로 초기 진입 비중을 보수적으로 조절하세요.`)
  }

  return points.slice(0, 5)
}

function convictionEntryBand(entryPrice: number, strategyLabel: string): { low: number; high: number } {
  // 전략별 진입 밴드 — 현재가 기준 상대 범위
  const offsets: Record<string, [number, number]> = {
    '눌림분할':  [-0.030, -0.005],  // 눌림 구간 진입
    '추세분할':  [-0.010,  0.010],  // 추세 추종 구간
    '지지매수':  [-0.025,  0.000],  // 지지선 하단~지지선
    '확인매수':  [ 0.000,  0.020],  // 확인 후 진입
  }
  const [lo, hi] = offsets[strategyLabel] ?? [-0.015, 0.015]
  return {
    low:  Math.round(entryPrice * (1 + lo)),
    high: Math.round(entryPrice * (1 + hi)),
  }
}

function convictionAdvisorSection(item: DailyCandidateForecast): string {
  const { entryPrice, expectedBasePct, expectedUpsidePct, expectedDrawdownPct, strategyLabel } = item
  const band = convictionEntryBand(entryPrice, strategyLabel)
  const stopPrice  = Math.round(entryPrice * (1 - expectedDrawdownPct / 100))
  const target1    = Math.round(entryPrice * (1 + expectedBasePct   / 100))
  const target2    = Math.round(entryPrice * (1 + expectedUpsidePct / 100))

  const fmt  = (n: number) => n.toLocaleString('ko-KR')
  const pct  = (n: number, sign = true) => `${sign && n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  const rows = [
    { label: '진입 구간',  value: `${fmt(band.low)} ~ ${fmt(band.high)}원`,                          color: '#191F28' },
    { label: '손절 기준',  value: `${fmt(stopPrice)}원 (${pct(-expectedDrawdownPct)})`,               color: '#1478FF' },
    { label: '1차 목표',   value: `${fmt(target1)}원 (${pct(expectedBasePct)})`,                     color: '#F04452' },
    { label: '2차 목표',   value: `${fmt(target2)}원 (${pct(expectedUpsidePct)})`,                   color: '#F04452' },
  ]

  const cells = rows.map(r =>
    `<div style="padding:10px 0;border-right:1px solid #F2F4F6;flex:1;min-width:0;padding-left:12px;padding-right:12px">
      <div style="font-size:10px;color:#8B95A1;margin-bottom:3px">${r.label}</div>
      <div style="font-size:12.5px;font-weight:700;color:${r.color};white-space:nowrap">${r.value}</div>
    </div>`
  ).join('')

  // 전략 요약 한 줄
  const adviceMap: Record<string, string> = {
    '눌림분할': '진입 구간 진입 시 2~3회 분할 매수. 손절가 이탈 시 즉시 정리하세요.',
    '추세분할': '추세 확인 후 분할 진입. 1차 목표 도달 시 절반 익절, 잔여 2차 목표 유지.',
    '지지매수': '지지선 하단 매수, 이탈 확정 시 손절. 반등 확인 후 추가 비중.',
    '확인매수': '확인 신호 이후 진입. 무릎에서 사고 어깨에서 파는 전략으로 목표 고정 후 진입.',
  }
  const advice = adviceMap[strategyLabel] ?? '분할 진입 후 손절가와 목표가를 고정하고 대응하세요.'

  return `<div style="border-top:1px solid #F2F4F6;background:#FAFBFC">
  <div style="display:flex;flex-wrap:wrap;border-bottom:1px solid #F2F4F6">
    ${cells}
  </div>
  <div style="padding:9px 14px;font-size:11.5px;color:#4A5568;line-height:1.6;display:flex;align-items:flex-start;gap:8px">
    <span style="color:#0060FF;font-weight:700;flex-shrink:0">어드바이스</span>
    <span>${escapeHtml(advice)}</span>
  </div>
</div>`
}

function buildConvictionCard(item: DailyCandidateForecast, index: number): string {
  const badgeColor = CONVICTION_RANK_BADGE[Math.min(index, CONVICTION_RANK_BADGE.length - 1)]
  const conf = convictionConfidenceLevel(item.confidencePct)
  const strat = convictionStrategyInfo(item.strategyLabel)
  const rationale = convictionRationalePoints(item)
  const edge = item.expectedUpsidePct - item.expectedDrawdownPct
  const entryFmt = Math.round(item.entryPrice).toLocaleString('ko-KR')
  const edgeColor = edge >= 7 ? '#007B5F' : edge >= 4 ? '#C85700' : '#F04452'

  return `<div style="margin-bottom:16px;border:1px solid #E5E8EB;border-radius:12px;background:#FFFFFF;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.04)">

  <div style="padding:14px 16px 12px;border-bottom:1px solid #F2F4F6;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${badgeColor};color:#fff;font-weight:700;font-size:13px;flex-shrink:0;margin-top:3px">${index + 1}</span>
    <div style="flex:1;min-width:160px">
      <div style="font-size:19px;font-weight:800;color:#191F28;letter-spacing:-0.02em;line-height:1.2">${escapeHtml(item.name)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">
        <code style="font-size:11px;background:#F2F4F6;padding:2px 7px;border-radius:4px;color:#8B95A1;font-family:monospace;letter-spacing:0.04em">${escapeHtml(item.code)}</code>
        <span style="font-size:11px;background:#EBF3FF;color:#0060FF;padding:2px 8px;border-radius:10px;border:1px solid rgba(0,96,255,0.2);font-weight:600">${escapeHtml(item.strategyLabel)}</span>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:10px;color:#8B95A1;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:3px">종합 신뢰도</div>
      <div style="font-size:26px;font-weight:800;color:${conf.color};line-height:1">${item.confidencePct.toFixed(1)}<span style="font-size:13px;font-weight:500">%</span></div>
      <div style="font-size:11px;font-weight:600;color:${conf.color};margin-top:2px">${conf.label}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);background:#F9FAFB">
    <div style="padding:11px 10px;text-align:center;border-right:1px solid #F2F4F6">
      <div style="font-size:10px;color:#8B95A1;margin-bottom:4px">기준 진입가</div>
      <div style="font-size:14px;font-weight:700;color:#191F28">${entryFmt}<span style="font-size:10px;font-weight:400;color:#8B95A1">원</span></div>
    </div>
    <div style="padding:11px 10px;text-align:center;border-right:1px solid #F2F4F6">
      <div style="font-size:10px;color:#8B95A1;margin-bottom:4px">기대 수익</div>
      <div style="font-size:14px;font-weight:700;color:#F04452">+${item.expectedBasePct.toFixed(1)}<span style="font-size:10px">%</span></div>
    </div>
    <div style="padding:11px 10px;text-align:center;border-right:1px solid #F2F4F6">
      <div style="font-size:10px;color:#8B95A1;margin-bottom:4px">상단 목표</div>
      <div style="font-size:14px;font-weight:700;color:#F04452">+${item.expectedUpsidePct.toFixed(1)}<span style="font-size:10px">%</span></div>
    </div>
    <div style="padding:11px 10px;text-align:center">
      <div style="font-size:10px;color:#8B95A1;margin-bottom:4px">예상 손실</div>
      <div style="font-size:14px;font-weight:700;color:#1478FF">-${item.expectedDrawdownPct.toFixed(1)}<span style="font-size:10px">%</span></div>
    </div>
  </div>

  <div style="padding:14px 16px;display:grid;grid-template-columns:minmax(160px,1fr) minmax(200px,1.4fr);gap:16px;border-top:1px solid #F2F4F6">

    <div>
      <div style="font-size:10px;color:#8B95A1;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:9px">점수 지표</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:#6B7280;flex-shrink:0;width:40px">모멘텀</span>
          ${convictionScoreBar(item.scoreComponents.momentum, '#F04452')}
          <span style="font-size:12px;font-weight:700;color:#191F28;width:26px;text-align:right;flex-shrink:0">${item.scoreComponents.momentum.toFixed(0)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:#6B7280;flex-shrink:0;width:40px">밸류</span>
          ${convictionScoreBar(item.scoreComponents.value, '#0060FF')}
          <span style="font-size:12px;font-weight:700;color:#191F28;width:26px;text-align:right;flex-shrink:0">${item.scoreComponents.value.toFixed(0)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:#6B7280;flex-shrink:0;width:40px">안전성</span>
          ${convictionScoreBar(item.scoreComponents.safety, '#00B493')}
          <span style="font-size:12px;font-weight:700;color:#191F28;width:26px;text-align:right;flex-shrink:0">${item.scoreComponents.safety.toFixed(0)}</span>
        </div>
      </div>
      <div style="margin-top:12px;padding:9px 11px;background:#F9FAFB;border-radius:8px;border:1px solid #E5E8EB;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:#8B95A1">기대 여지</span>
        <span style="font-size:16px;font-weight:800;color:${edgeColor}">+${edge.toFixed(1)}<span style="font-size:11px;font-weight:500">%</span></span>
      </div>
    </div>

    <div>
      <div style="font-size:10px;color:#8B95A1;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:9px">매수 확신 근거</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${rationale.map((r) => `<div style="font-size:11.5px;color:#191F28;line-height:1.6;padding:6px 10px;background:#F9FAFB;border-radius:6px;border-left:2px solid #E5E8EB">${escapeHtml(r)}</div>`).join('')}
      </div>
    </div>

  </div>
  ${convictionAdvisorSection(item)}
</div>`
}

export function buildConvictionWebHtml(
  forecasts: DailyCandidateForecast[],
  limit = 10,
): string {
  const ranked = [...forecasts]
    .sort((a, b) => {
      if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct
      const aEdge = a.expectedUpsidePct - a.expectedDrawdownPct
      const bEdge = b.expectedUpsidePct - b.expectedDrawdownPct
      return bEdge - aEdge
    })
    .slice(0, Math.max(1, limit))

  if (!ranked.length) {
    return '<p style="color:#718096;padding:24px 0;text-align:center;font-size:14px">현재 조건에서 확신 후보를 찾지 못했습니다.<br>시장 변동성이 낮아지면 추천 리포트로 다시 확인하세요.</p>'
  }

  const cards = ranked.map((item, i) => buildConvictionCard(item, i)).join('\n')

  return `<div style="margin-bottom:16px;padding:13px 15px;background:linear-gradient(135deg,#EBF3FF 0%,#E6FAF5 100%);border-radius:10px;border:1px solid #C2D6FF">
  <div style="font-size:13px;font-weight:700;color:#191F28;margin-bottom:3px">눌림목·점수·리스크를 종합한 확신 후보 ${ranked.length}개 종목 — 신뢰도 높은 순 정렬</div>
  <div style="font-size:11px;color:#8B95A1">과거 유사 구간 기반 추정치입니다. 실전 체결·슬리피지에 따라 실제 결과는 달라질 수 있습니다.</div>
</div>
${cards}
<div style="padding:14px 16px;background:#F9FAFB;border-radius:10px;border:1px solid #E5E8EB;font-size:12px;line-height:1.85;color:#6B7280">
  <strong style="color:#191F28">매수 원칙</strong>&nbsp; 상위 1~2개에 우선 집중하고, 추격 진입보다 분할 매수로 평단을 낮추세요. 진입 전 손절가와 익절가를 먼저 고정하는 습관이 중요합니다.<br>
  <span style="color:#8B95A1;font-size:11px">이 리포트는 SSB의 복합 지표 모델이 자동 생성합니다. 투자 판단은 최종적으로 본인 책임 하에 이루어져야 합니다.</span>
</div>`
}

export function buildCandidateCardsWebHtml(params: {
  forecasts: DailyCandidateForecast[]
  title: string
  subtitle: string
  note?: string
  limit?: number
}): string {
  const { forecasts, title, subtitle, note, limit = 8 } = params
  const ranked = [...(forecasts || [])]
    .sort((a, b) => {
      if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct
      const aEdge = a.expectedUpsidePct - a.expectedDrawdownPct
      const bEdge = b.expectedUpsidePct - b.expectedDrawdownPct
      return bEdge - aEdge
    })
    .slice(0, Math.max(1, limit))

  if (!ranked.length) {
    return '<p style="color:#718096;padding:24px 0;text-align:center;font-size:14px">현재 조건에서 표시할 후보를 찾지 못했습니다.<br>잠시 후 다시 확인해 주세요.</p>'
  }

  const cards = ranked.map((item, i) => buildConvictionCard(item, i)).join('\n')
  const footerNote = note
    ? escapeHtml(note)
    : '실전 체결가·슬리피지에 따라 결과는 달라질 수 있습니다. 분할 진입과 손절 기준을 먼저 고정해 주세요.'

  return `<div style="margin-bottom:16px;padding:13px 15px;background:linear-gradient(135deg,#EBF3FF 0%,#E6FAF5 100%);border-radius:10px;border:1px solid #C2D6FF">
  <div style="font-size:13px;font-weight:700;color:#191F28;margin-bottom:3px">${escapeHtml(title)}</div>
  <div style="font-size:11px;color:#8B95A1">${escapeHtml(subtitle)}</div>
</div>
${cards}
<div style="padding:14px 16px;background:#F9FAFB;border-radius:10px;border:1px solid #E5E8EB;font-size:12px;line-height:1.85;color:#6B7280">
  <strong style="color:#191F28">운용 메모</strong>&nbsp; ${footerNote}
</div>`
}

export function buildPullbackWebHtml(input: {
  title: string
  summaryText: string
  caption: string
}): string {
  const title = escapeHtml(input.title || '다음 주 눌림목 리포트')
  const sectionHeadline = title === '다음 주 눌림목 리포트' ? '다음 주 선진입 후보 요약' : `${title} 요약`
  const summary = String(input.summaryText || '').trim()
  const caption = escapeHtml(input.caption || '')
  const lines = summary.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const topLine = lines.find((line) => line.includes('상위 후보')) || lines[0] || ''
  const candidates = (() => {
    const raw = topLine.split(':').slice(1).join(':').trim()
    if (!raw) return [] as string[]
    return raw
      .split('/')
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6)
  })()
  const metaLine = lines.find((line) => line.includes('데이터 상태')) || ''
  const guideLine = lines.find((line) => line.includes('진입 밴드') || line.includes('목표가'))
    || lines.find((line) => line.includes('분할 진입'))
    || '분할 진입 밴드와 목표가 기준을 먼저 고정하고 대응하세요.'
  const narrative = lines
    .filter((line) => line !== topLine && line !== metaLine)
    .slice(0, 3)

  return `<section style="border:1px solid #d8e5ff;background:linear-gradient(135deg,#f0f6ff 0%,#ffffff 62%);border-radius:16px;padding:16px 16px 14px;box-shadow:0 2px 10px rgba(20,80,180,0.06)">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#2a5bb8;text-transform:uppercase">Next Week Pullback</div>
      <div style="margin-top:4px;font-size:22px;line-height:1.22;font-weight:800;letter-spacing:-0.02em;color:#102542">${sectionHeadline}</div>
    </div>
    <div style="font-size:11px;color:#4b668f;background:#e8f0ff;border:1px solid #c8dafd;padding:4px 10px;border-radius:999px">스윙/중기 선진입 후보</div>
  </div>
  <div style="margin-top:12px;padding:11px 12px;border-radius:12px;background:#ffffff;border:1px solid #dce6f4;color:#2a3547;font-size:12.5px;line-height:1.7">
    ${escapeHtml(guideLine)}
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
    ${candidates.length ? candidates.map((candidate, idx) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid #cfe0ff;background:#ffffff;color:#1b3b70;font-size:12px;font-weight:600"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${idx === 0 ? '#2a5bb8' : '#9eb8e5'};color:#fff;font-size:10px;font-weight:700">${idx + 1}</span>${escapeHtml(candidate)}</span>`).join('') : '<span style="font-size:12px;color:#6b7280">상위 후보 데이터가 아직 준비되지 않았습니다.</span>'}
  </div>
</section>
${narrative.length ? `<section style="margin-top:12px;border:1px solid #e4ebf5;background:#ffffff;border-radius:14px;padding:14px 14px 12px"><div style="font-size:12px;color:#415168;line-height:1.8">${narrative.map((line) => `<p style=\"margin:0 0 6px\">${escapeHtml(line)}</p>`).join('')}</div></section>` : ''}
${metaLine ? `<section style="margin-top:12px;border:1px solid #e8edf2;background:#f7fafc;border-radius:12px;padding:10px 12px;font-size:11.5px;color:#5a6a7f">${escapeHtml(metaLine)}</section>` : ''}
${caption ? `<section style="margin-top:10px;color:#6f7f93;font-size:13px;font-style:italic">${caption}</section>` : ''}`
}

// ─── Page Layout ─────────────────────────────────────────────────────────────

export function renderLayout(params: {
  title: string
  topic: string
  sourceLabel: string
  contentHtml: string
  description?: string
  shareLocked?: boolean
}): string {
  const { title, topic, sourceLabel, contentHtml, description, shareLocked = false } = params
  const desc = description || `${topicLabel(topic)} 리포트를 웹에서 열람합니다.`
  const badge = shareLocked ? '공유 링크' : topicLabel(topic)
  const topicClass = topic === '눌림목' ? 'topic-pullback' : ''

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>
    :root {
      color-scheme: light;
      --color-blue-50: #EBF3FF;
      --color-blue-500: #0060FF;
      --color-gray-0: #FFFFFF;
      --color-gray-50: #F9FAFB;
      --color-gray-100: #F2F4F6;
      --color-gray-200: #E5E8EB;
      --color-gray-500: #8B95A1;
      --color-gray-600: #6B7280;
      --color-gray-900: #191F28;
      --color-gray-950: #0D1117;
      --color-brand: var(--color-blue-500);
      --color-brand-subtle: var(--color-blue-50);
      --color-bg-page: var(--color-gray-100);
      --color-bg-surface: var(--color-gray-0);
      --color-border-default: var(--color-gray-200);
      --color-text-primary: var(--color-gray-900);
      --color-text-secondary: var(--color-gray-600);
      --color-text-tertiary: var(--color-gray-500);
      --color-stock-up:   #F04452;
      --color-stock-down: #1478FF;
      --color-stock-flat: var(--color-gray-500);
      --color-bg-sunken: var(--color-gray-50);
      --font-family-sans: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      --font-family-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --font-weight-medium: 500;
      --font-weight-semibold: 600;
      --font-weight-bold: 700;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --shadow-sm: 0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      --code-bg: var(--color-gray-950);
      --code-text: #E2E8F0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; min-height: 100%;
      background: radial-gradient(circle at top right, rgba(0,96,255,0.14), transparent 28%),
                  linear-gradient(180deg, #f8fafc 0%, var(--color-bg-page) 100%);
      color: var(--color-text-primary);
    }
    body {
      font-family: var(--font-family-sans);
      line-height: 1.6;
      min-height: 100dvh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 24px 16px 40px;
    }
    .shell {
      width: min(980px, 100%);
      margin: 0 auto;
      background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-border-default) 92%, transparent);
      backdrop-filter: blur(14px);
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    .hero {
      padding: 22px 22px 18px;
      border-bottom: 1px solid var(--color-border-default);
      background: linear-gradient(120deg, var(--color-brand-subtle), rgba(255,255,255,0.97) 55%);
    }
    .topic-pullback .hero {
      background:
        radial-gradient(circle at 20% -10%, rgba(42, 91, 184, 0.22), transparent 34%),
        linear-gradient(120deg, #eaf2ff 0%, #f8fbff 52%, #ffffff 100%);
    }
    .topic-pullback .badge {
      color: #1f4f9d;
      background: #e7f0ff;
      border-color: rgba(31, 79, 157, 0.24);
    }
    .topic-pullback h1 {
      color: #102542;
    }
    .badge {
      display: inline-block;
      color: var(--color-brand);
      background: var(--color-brand-subtle);
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.04em;
      border: 1px solid color-mix(in srgb, var(--color-brand) 20%, transparent);
    }
    h1 {
      margin: 10px 0 6px;
      font-size: clamp(20px, 3.2vw, 28px);
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: var(--color-text-primary);
    }
    .meta { color: var(--color-text-secondary); font-size: 13px; }
    .content { padding: 20px 22px; font-size: 15px; }
    .rich-share { display: flex; flex-direction: column; gap: 12px; }
    .report-section {
      background: linear-gradient(180deg, #ffffff 0%, #fcfdff 100%);
      border: 1px solid var(--color-border-default);
      border-radius: 14px;
      padding: 14px 14px 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .content p { margin: 0.68em 0; line-height: 1.75; }
    .content h2 {
      margin: 0 0 0.62em;
      font-size: 1.05rem;
      font-weight: var(--font-weight-bold);
      line-height: 1.35;
      letter-spacing: -0.01em;
      color: var(--color-text-primary);
      padding-bottom: 0.38em;
      border-bottom: 1px solid color-mix(in srgb, var(--color-brand) 18%, #ffffff);
    }
    .content h2:first-child { margin-top: 0.2em; }
    .content hr { border: 0; border-top: 1px solid var(--color-border-default); margin: 0.9em 0; }
    .content ul, .content ol { margin: 0.55em 0 0.9em; padding-left: 1.4em; }
    .content li { line-height: 1.7; }
    .content li + li { margin-top: 0.28em; }
    .content code {
      font-family: var(--font-family-mono);
      font-size: 0.88em;
      background: color-mix(in srgb, var(--color-brand-subtle) 65%, #ffffff);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      padding: 0.1em 0.36em;
    }
    .content pre {
      margin: 0; padding: 14px; overflow: auto; border-radius: var(--radius-md);
      background: var(--code-bg); color: var(--code-text);
      font-family: var(--font-family-mono); font-size: 13px; line-height: 1.55;
      white-space: pre-wrap; word-break: break-word;
    }
    .footer {
      padding: 14px 22px 22px;
      border-top: 1px solid var(--color-border-default);
      color: var(--color-text-secondary);
      font-size: 12px;
      background: color-mix(in srgb, var(--color-gray-50) 80%, transparent);
    }
    @media (max-width: 720px) {
      body { padding: 10px 8px 32px; }
      .hero, .content, .footer { padding-left: 14px; padding-right: 14px; }
      .content { padding-top: 16px; }
      .report-section { padding: 12px 11px; border-radius: 12px; }
    }
    @media (max-width: 500px) {
      /* Conviction grid: stack to 2x2 on very small screens */
      .content [style*="grid-template-columns:repeat(4"] {
        grid-template-columns: repeat(2, 1fr) !important;
      }
      .content [style*="grid-template-columns:minmax"] {
        grid-template-columns: 1fr !important;
      }
    }
  </style>
</head>
<body>
  <main class="shell ${topicClass}">
    <header class="hero">
      <span class="badge">${escapeHtml(badge)}</span>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">출처: ${escapeHtml(sourceLabel)} · 웹 렌더링 뷰</div>
    </header>
    <article class="content">${contentHtml}</article>
    <footer class="footer">공유 링크는 만료되거나 철회될 수 있습니다.</footer>
  </main>
</body>
</html>`
}
