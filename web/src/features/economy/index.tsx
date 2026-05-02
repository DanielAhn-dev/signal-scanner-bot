import React from 'react'

const INDICATORS = [
  { label: 'KOSPI', desc: '국내 대형주 지수. 시장 방향성 기준', cmd: '/kospi' },
  { label: 'KOSDAQ', desc: '국내 중소형·기술주 지수', cmd: '/kosdaq' },
  { label: 'VIX', desc: '공포지수. 20↑ 변동성 주의, 30↑ 위험', cmd: '/economy' },
  { label: 'S&P 500', desc: '미국 대형주 500 지수', cmd: '/economy' },
  { label: 'NASDAQ', desc: '미국 기술주 중심 지수', cmd: '/economy' },
  { label: '원/달러', desc: '환율. 달러 강세 시 외국인 수급 약화', cmd: '/economy' },
  { label: '금(Gold)', desc: '안전자산. 불확실성 지표', cmd: '/economy' },
  { label: '국고채 10Y', desc: '금리 방향성. 상승 시 주식 밸류에이션 압박', cmd: '/economy' },
]

export default function EconomyPage() {
  return (
    <section className="container-app">
      <h1 className="title-xl">글로벌 경제지표</h1>

      <div className="card mb-4">
        <div className="muted">
          텔레그램 <code>/economy</code>에 대응합니다. 실시간 지표는 텔레그램 명령으로 조회하세요.
          실시간 API 연동이 준비되면 이 화면에서 직접 조회할 수 있습니다.
        </div>
      </div>

      <div className="cards-grid cols-2">
        {INDICATORS.map(ind => (
          <div key={ind.label} className="card">
            <div className="stat-label">{ind.label}</div>
            <div className="stat-value" style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-tertiary)' }}>—</div>
            <div className="stat-sub">{ind.desc}</div>
            <div className="caption mt-2" style={{ marginTop: 'var(--space-2)' }}>
              텔레그램: <code>{ind.cmd}</code>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
