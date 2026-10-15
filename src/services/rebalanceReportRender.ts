/**
 * 실계좌 리밸런싱 가이드 리포트 HTML — 계산은 src/lib/rebalanceReport.ts. 리포트 화면 미리보기·파일 저장(인쇄로 PDF)에 쓴다.
 */
import type { RebalanceReport, ReportAction } from '../lib/rebalanceReport'
import { escapeHtml, renderLayout } from './reportWebRenderService'

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const man = (v: number) => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
const pct = (v: number | null, d = 1) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? ' rb-up' : ' rb-down')
const e = escapeHtml

const ACTION_LABEL: Record<ReportAction, string> = {
  sell: '정리',
  'sell-later': '회복 시 정리',
  buy: '모으기',
  'stop-add': '추가매수 멈춤',
  hold: '보유',
}

const STYLE = `<style>
  .rb-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:0 0 16px; }
  .rb-kpi { border:1px solid #E1E5E2; padding:10px 12px; }
  .rb-kpi small { display:block; color:#526159; font-size:12px; }
  .rb-kpi b { font-size:17px; font-variant-numeric:tabular-nums; }
  .rb-headline { background:#F1F5F3; border-left:3px solid #24543D; padding:10px 12px; margin:0 0 16px; word-break:keep-all; }
  .rb-alert { background:#FFF6E5; border-left:3px solid #B7791F; padding:10px 12px; margin:0 0 16px; word-break:keep-all; }
  .rb-table { width:100%; border-collapse:collapse; font-size:13px; margin:6px 0 4px; }
  .rb-table th, .rb-table td { border:1px solid #E1E5E2; padding:6px 8px; text-align:right; vertical-align:top; }
  .rb-table th { text-align:center; white-space:nowrap; }
  .rb-table td.rb-l { text-align:left; word-break:keep-all; }
  .rb-wrap { overflow-x:auto; }
  .rb-up { color:#C0392B; } .rb-down { color:#1F5FAF; }
  .rb-chip { display:inline-block; padding:1px 6px; border:1px solid currentColor; font-size:11px; white-space:nowrap; }
  .rb-sell { color:#C0392B; } .rb-sell-later { color:#B7791F; } .rb-buy { color:#24543D; } .rb-stop-add { color:#6B4FA0; } .rb-hold { color:#7A857F; }
  .rb-muted { color:#7A857F; font-size:12px; }
  .rb-steps { padding-left:20px; } .rb-steps li { margin:4px 0; word-break:keep-all; }
  .rb-list li { margin:4px 0; word-break:keep-all; }
  .report-section h2 { font-size:16px; margin:0 0 8px; }
  @media (max-width:720px) { .rb-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>`

function section(title: string, body: string): string {
  return `<section class="report-section"><h2>${e(title)}</h2>${body}</section>`
}

export function renderRebalanceReportHtml(r: RebalanceReport, generatedAt: string): string {
  const a = r.account
  const parts: string[] = [STYLE]

  parts.push(`<div class="rb-headline"><b>${e(r.headline)}</b></div>`)
  parts.push(`<div class="rb-kpis">
    <div class="rb-kpi"><small>평가금액</small><b>${man(a.total)}</b></div>
    <div class="rb-kpi"><small>평가손익</small><b class="${tone(a.pnl)}">${a.pnl == null ? '-' : `${man(a.pnl)} (${pct(a.pnlPct)})`}</b></div>
    <div class="rb-kpi"><small>월 분배금(세후 추정)</small><b>${man(r.income.accountMonthlyNet)}</b></div>
    <div class="rb-kpi"><small>전체 실계좌 중</small><b>${a.shareOfAllPct.toFixed(0)}%</b></div>
  </div>`)

  if (r.market) {
    const m = r.market
    const text = m.drawdown
      ? `코스피 ${e(m.asOf)} 기준 최근 60거래일 고점 대비 <b>${pct(m.fromHighPct)}</b>(전일 대비 ${pct(m.changePct)}). 하락 구간에서 손실 종목을 팔면 손실이 확정되고 반등을 놓칩니다. 이 리포트의 매도는 <b>평단 이상(수익 구간) 종목만</b>이고, 나머지는 가격 조건부로 미룹니다.`
      : `코스피 ${e(m.asOf)} 기준 최근 60거래일 고점 대비 ${pct(m.fromHighPct)}(전일 대비 ${pct(m.changePct)}). 매도는 평단 이상(수익 구간) 종목만 다룹니다.`
    parts.push(`<div class="${m.drawdown ? 'rb-alert' : 'rb-headline'}">${text}</div>`)
  }

  // 1. 계좌 구성
  const groupRows = r.accountGroups.map((g) => `<tr><td class="rb-l">${e(g.label)}</td><td>${man(g.value)}</td><td>${g.pct.toFixed(1)}%</td></tr>`).join('')
  const pRows = r.portfolio.groups
    .map((g) => `<tr><td class="rb-l">${e(g.label)}</td><td>${g.actualPct.toFixed(1)}%</td><td>${g.targetPct.toFixed(1)}%</td><td>${g.outOfBand ? '<span class="rb-chip rb-sell">밴드 밖</span>' : '안'}</td></tr>`)
    .join('')
  parts.push(section('1. 계좌 구성', `
    <p>${e(a.label)} · ${a.taxAdvantaged ? '절세 계좌(ISA·연금)' : '일반 계좌'} · ${a.holdingCount}종목</p>
    <div class="rb-wrap"><table class="rb-table"><thead><tr><th>바구니</th><th>평가금액</th><th>계좌 안 비중</th></tr></thead><tbody>${groupRows}</tbody></table></div>
    <p class="rb-muted">전체 실계좌 ${r.portfolio.accountCount}개(${man(r.portfolio.total)}) 기준 목표 — ${r.portfolio.targetSource === 'custom' ? '직접 정한 목표' : '단계 기본 목표'}, ±10%p 밖일 때만 팔아서 맞춥니다.</p>
    <div class="rb-wrap"><table class="rb-table"><thead><tr><th>바구니(전체)</th><th>지금</th><th>목표</th><th>±10%p</th></tr></thead><tbody>${pRows}</tbody></table></div>`))

  // 2. 인컴
  const inc = r.income
  const incBody: string[] = []
  incBody.push(`<p>이 계좌 인컴 비중 <b>${inc.accountIncomePct.toFixed(1)}%</b> · 인컴 중 커버드콜 <b>${inc.coveredCallShareOfIncomePct.toFixed(0)}%</b>(상한 33%) · 전체 인컴 비중 ${inc.portfolioIncomePct.toFixed(1)}%(목표 ${inc.portfolioIncomeTargetPct.toFixed(1)}%)${inc.portfolioMonthlyNet != null ? ` · 전체 월 인컴 ${man(inc.portfolioMonthlyNet)}(${inc.portfolioSource === 'actual' ? '실제 입금' : '추정'}) / 목표 ${man(inc.floor)}` : ''}</p>`)
  if (inc.stopReasons.length) incBody.push(`<p><b>인컴 추가매수를 멈출 때입니다.</b></p><ul class="rb-list">${inc.stopReasons.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`)
  if (inc.lines.length) incBody.push(`<ul class="rb-list">${inc.lines.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`)
  parts.push(section('2. 하락장에서 인컴을 더 사는 것에 대해', incBody.join('')))

  // 3. 지금 팔 것
  if (r.sells.length) {
    const rows = r.sells
      .map((s) => `<tr>
        <td class="rb-l"><b>${e(s.name)}</b><br><span class="rb-muted">${e(s.code)}</span></td>
        <td>${s.shares.toLocaleString('ko-KR')}주</td><td>${won(s.price)}</td><td>${man(s.amount)}</td>
        <td class="${tone(s.realizedGain)}">${won(s.realizedGain)}</td><td>${won(s.cost)}</td>
        <td class="${tone(s.monthlyIncomeDelta)}">${won(s.monthlyIncomeDelta)}</td>
        <td class="rb-l">${s.to ? e(s.to.name) : '-'}</td>
        <td class="rb-l">${e(s.reason)}</td></tr>`)
      .join('')
    const total = r.sells.reduce((s, x) => s + x.net, 0)
    parts.push(section('3. 지금 팔 것 (수익 구간만)', `
      <div class="rb-wrap"><table class="rb-table"><thead><tr><th>종목</th><th>수량</th><th>현재가</th><th>금액</th><th>확정 손익</th><th>비용</th><th>월 분배금 변화</th><th>옮길 곳</th><th>이유</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="rb-muted">비용을 뺀 매도 대금 합계 약 ${man(total)}. 분배락일 직전이면 분배금을 받은 뒤 팝니다.</p>`))
  } else {
    parts.push(section('3. 지금 팔 것 (수익 구간만)', '<p>지금 수익 구간에서 정리할 종목은 없습니다. 손실 종목은 팔지 않고, 새 돈과 분배금 방향만 바꿉니다.</p>'))
  }

  // 4. 살 것
  const b = r.buy
  parts.push(section('4. 살 것 · 분배금 보낼 곳', `
    <p><b>${b.target ? e(b.target.name) : '지수 ETF (새로 정하기)'}</b> — ${e(b.hint)}</p>
    <ul class="rb-list">
      ${b.fromSells > 0 && b.target ? `<li>매도 대금 약 ${man(b.fromSells)} → 약 ${b.shares.toLocaleString('ko-KR')}주 (현재가 ${won(b.target.price)}), 판 날 바로 삽니다.</li>` : ''}
      <li>분배금 월 약 ${man(b.monthlyDistribution)}(세후 추정) → 들어오는 대로 ${b.target ? e(b.target.name) : '지수 ETF'}로.</li>
      ${b.monthlyContribution > 0 ? `<li>새 돈 월 ${man(b.monthlyContribution)} → 같은 곳으로.</li>` : ''}
      ${r.growth && r.growth.needByNewMoney > 0 ? `<li>전체 성장 비중 ${r.growth.actualPct.toFixed(0)}% → 목표 ${r.growth.targetPct.toFixed(0)}%: 새 돈만으로 약 ${man(r.growth.needByNewMoney)} 필요${r.growth.months ? `, 지금 속도면 약 ${r.growth.months}개월` : ''}.</li>` : ''}
    </ul>`))

  // 5. 조건부
  if (r.conditionals.length) {
    const rows = r.conditionals
      .map((c) => `<tr><td class="rb-l"><b>${e(c.name)}</b></td><td>${won(c.price)}</td><td><b>${won(c.triggerPrice)}</b></td><td>${pct((c.triggerPrice / c.price - 1) * 100)}</td><td>${c.shares.toLocaleString('ko-KR')}주</td><td class="rb-l">${e(c.reason)}</td></tr>`)
      .join('')
    parts.push(section('5. 가격이 오면 정리할 것 (조건부)', `
      <div class="rb-wrap"><table class="rb-table"><thead><tr><th>종목</th><th>현재가</th><th>조건 가격</th><th>남은 거리</th><th>수량</th><th>할 일</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="rb-muted">월 1회 점검 때 조건 가격 이상인 종목만 실행합니다. 매일 확인하지 않습니다.</p>`))
  }

  // 6. 종목별
  const holdingRows = r.rows
    .map((h) => `<tr>
      <td class="rb-l"><b>${e(h.name)}</b><br><span class="rb-muted">${e(h.bucketLabel)}</span></td>
      <td>${h.quantity.toLocaleString('ko-KR')}</td><td>${h.avgPrice == null ? '-' : won(h.avgPrice)}</td><td>${won(h.price)}</td>
      <td>${man(h.value)}</td><td class="${tone(h.pnlPct)}">${pct(h.pnlPct)}</td><td>${h.weightPct.toFixed(1)}%</td>
      <td>${h.yieldPct.toFixed(1)}%${h.yieldSource === 'assumed' ? '<span class="rb-muted">*</span>' : ''}</td><td>${won(h.monthlyNet)}</td>
      <td class="rb-l"><span class="rb-chip rb-${h.action}">${ACTION_LABEL[h.action]}</span><br>${e(h.actionText)}</td></tr>`)
    .join('')
  parts.push(section('6. 종목별 판단', `
    <div class="rb-wrap"><table class="rb-table"><thead><tr><th>종목</th><th>수량</th><th>평단</th><th>현재가</th><th>평가</th><th>손익</th><th>비중</th><th>분배율</th><th>월 분배금</th><th>판단</th></tr></thead><tbody>${holdingRows}</tbody></table></div>
    <p class="rb-muted">분배율: 네이버 최근 12개월. * 표시는 자료가 없어 상품 유형별 가정을 쓴 값입니다.</p>`))

  // 7. 실행 순서
  parts.push(section('7. 실행 순서', `<ol class="rb-steps">${r.steps.map((s) => `<li>${e(s)}</li>`).join('')}</ol>`))
  parts.push(section('기준과 한계', `<ul class="rb-list rb-muted">${r.notes.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`))

  return renderLayout({
    title: `리밸런싱 가이드 · ${a.label}`,
    topic: '리밸런싱',
    sourceLabel: `${r.today} 기준 · 생성 ${generatedAt} · 실계좌 입력 보유 기준`,
    description: '실계좌 리밸런싱 가이드 — 수익 구간 정리, 분배금 통합, 지수로 옮기는 순서',
    contentHtml: parts.join('\n'),
  })
}
