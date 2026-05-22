/**
 * Dashboard — 중앙 패널: 엑셀 셀 병합 스타일 대시보드
 * 오늘의 플로우 / 포트폴리오 요약 / 유망 섹터 Top 8
 */
import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'

type SectorItem = {
  name?: string
  score?: number
  change?: number
  changeRate?: number
}

type PortfolioSummary = {
  total_pnl?: number
  positions?: unknown[]
}

const FLOW_STEPS = [
  { num: '01', title: '시장 확인',  desc: '거시변동성·섹터 흐름부터 먼저 본다.',      link: '경제 / 시장 열기 →', route: 'market'    },
  { num: '02', title: '후보 압축',  desc: '스캔과 놓임목으로 3~5개만 남긴다.',        link: '스캔 열기 →',       route: 'scan'      },
  { num: '03', title: '종목 검증',  desc: '분석·수급·재무로 진입 전 걸러낸다.',       link: '분석 열기 →',       route: 'analyze'   },
  { num: '04', title: '실행 / 복기',desc: '포트폴리오와 리포트로 실행을 담는다.',      link: '포트폴리오 보기 →', route: 'portfolio' },
]

// 셀 스타일 헬퍼
const S = {
  header: {
    background: 'var(--color-excel-cell-header)',
    fontWeight: 700,
    fontSize: 10,
  } as React.CSSProperties,
  sectionTitle: {
    background: '#E2EFDA',
    borderBottom: '1px solid #A9D18E',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.02em',
    color: '#276221',
  } as React.CSSProperties,
  divider: {
    height: 3,
    background: '#E2EFDA',
    borderTop: '1px solid #A9D18E',
    borderBottom: '1px solid #A9D18E',
    padding: 0,
  } as React.CSSProperties,
  midBorder: {
    borderRight: '2px solid var(--color-gray-400)',
  } as React.CSSProperties,
  link: {
    color: 'var(--color-brand)',
    cursor: 'pointer',
    fontSize: 10,
  } as React.CSSProperties,
}

function fmtPnl(v?: number): string {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('ko-KR') + '원'
}

function fmtChange(v?: number): string {
  if (v == null) return ''
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function changeColor(v?: number): string | undefined {
  if (v == null) return undefined
  return v >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
}

export default function Dashboard({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const chatId = useCurrentChatId()
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [sectors, setSectors]     = useState<SectorItem[]>([])
  const [topSector, setTopSector] = useState<string>('')
  const [fillerRows, setFillerRows] = useState(0)

  // chatId가 준비되면 포트폴리오 로드 (스토어 hydration 완료 후 실행)
  useEffect(() => {
    if (!chatId) return
    apiFetch('/api/ui/portfolio-realtime', {
      method: 'GET',
      headers: { 'x-user-chat-id': chatId },
      cacheMs: 0,
    }).then(res => {
      if (res?.ok && res.data) setPortfolio(res.data)
    }).catch(() => {})
  }, [chatId])

  useEffect(() => {
    apiFetch('/api/ui?route=sectors&top=8', { cacheMs: 300_000 }).then(res => {
      const list: SectorItem[] = res?.data ?? res?.sectors ?? []
      setSectors(list)
      if (list.length > 0) setTopSector(list[0]?.name ?? '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const BASE_ROWS = 21
    const updateFillerRows = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const rowHeight = width < 640 ? 26 : width < 1024 ? 26 : 22
      const chromeHeight = width < 640 ? 280 : 230
      const estimatedVisibleRows = Math.floor(Math.max(0, height - chromeHeight) / rowHeight)
      const needed = Math.max(0, estimatedVisibleRows - BASE_ROWS)
      setFillerRows(Math.min(60, needed))
    }
    updateFillerRows()
    window.addEventListener('resize', updateFillerRows)
    return () => window.removeEventListener('resize', updateFillerRows)
  }, [])

  const nav = (r: string) => onNavigate?.(r)

  const posCount = portfolio?.positions?.length ?? 0
  const pnl = portfolio?.total_pnl
  const pnlColor = pnl == null ? undefined : pnl >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'

  // 행번호 카운터
  let rn = 0
  const rowNum = () => ++rn

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 28 }}/>  {/* 행번호 — CSS로 숨겨지면 width 0 처리됨 */}
          <col style={{ width: '17%' }}/> {/* A */}
          <col style={{ width: '17%' }}/> {/* B */}
          <col style={{ width: '17%' }}/> {/* C */}
          <col style={{ width: '17%' }}/> {/* D */}
          <col style={{ width: '20%' }}/> {/* E */}
          <col/>                          {/* F */}
        </colgroup>
        <thead>
          <tr className="xls-letter-row">
            <th className="xls-corner"/>
            <th className="xls-col-letter">A</th>
            <th className="xls-col-letter">B</th>
            <th className="xls-col-letter">C</th>
            <th className="xls-col-letter">D</th>
            <th className="xls-col-letter">E</th>
            <th className="xls-col-letter">F</th>
          </tr>
        </thead>
        <tbody>

          {/* ── 이벤트 배너 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', fontWeight: 600, fontSize: 11 }}>
              📌 미국 PPI (YoY) · 발표값 과거 반응: -0.40%
              <span style={{ float: 'right', fontSize: 10, fontWeight: 400 }}>
                <span style={S.link} onClick={() => nav('market')}>📅 캘린더</span>
              </span>
            </td>
          </tr>

          {/* 빈 행 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell xls-cell--empty" colSpan={6}/>
          </tr>

          {/* ── 오늘의 플로우 헤더 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              오늘의 플로우
              <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('reports')}>
                복기 보기 →
              </span>
            </td>
          </tr>

          {/* 플로우 — 번호 + 타이틀 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            {FLOW_STEPS.map((s, i) => (
              <td
                key={s.num}
                className="xls-cell"
                colSpan={i < 2 ? 2 : 1}
                style={{ ...S.header, ...(i === 1 ? S.midBorder : {}), borderLeft: i === 2 ? '1px solid var(--color-excel-grid-border)' : undefined }}
              >
                <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginRight: 4, fontSize: 10 }}>{s.num}</span>
                <span style={{ color: 'var(--color-brand)', fontWeight: 700, fontSize: 10 }}>{s.title}</span>
              </td>
            ))}
          </tr>

          {/* 플로우 — 설명 */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            {FLOW_STEPS.map((s, i) => (
              <td
                key={s.num}
                className="xls-cell"
                colSpan={i < 2 ? 2 : 1}
                style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'normal', lineHeight: 1.5, ...(i === 1 ? S.midBorder : {}) }}
              >
                {s.desc}
              </td>
            ))}
          </tr>

          {/* 플로우 — 링크 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            {FLOW_STEPS.map((s, i) => (
              <td
                key={s.num}
                className="xls-cell"
                colSpan={i < 2 ? 2 : 1}
                style={{ ...(i === 1 ? S.midBorder : {}) }}
              >
                <span style={S.link} onClick={() => nav(s.route)}>{s.link}</span>
              </td>
            ))}
          </tr>

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 보유 종목 | 미실현 손익 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.header, ...S.midBorder }}>보유 종목</td>
            <td className="xls-cell" colSpan={3} style={S.header}>미실현 손익</td>
          </tr>

          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.midBorder, fontSize: 20, fontWeight: 700, lineHeight: 1.2, padding: '4px 6px' }}>
              {posCount > 0 ? posCount : '—'}
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 4 }}>종목</span>
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, padding: '4px 6px', color: pnlColor }}>
              {fmtPnl(pnl)}
            </td>
          </tr>

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={S.midBorder}>
              <span style={S.link} onClick={() => nav('portfolio')}>가상 포트폴리오 →</span>
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              평가손익 합계
            </td>
          </tr>

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 마지막 스캔 | 1위 섹터 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.header, ...S.midBorder }}>마지막 스캔</td>
            <td className="xls-cell" colSpan={3} style={S.header}>1위 섹터</td>
          </tr>

          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={{ ...S.midBorder, fontSize: 14, fontWeight: 700, padding: '4px 6px' }}>
              5. 12. 오전 02:29
            </td>
            <td className="xls-cell" colSpan={3} style={{ fontSize: 14, fontWeight: 700, padding: '4px 6px', color: 'var(--color-brand)' }}>
              {topSector || '반도체'}
            </td>
          </tr>

          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={3} style={S.midBorder}>
              <span style={S.link} onClick={() => nav('scan')}>스캔 실행 시작</span>
            </td>
            <td className="xls-cell" colSpan={3}>
              <span style={S.link} onClick={() => nav('sectors')}>섹터 페이지 →</span>
            </td>
          </tr>

          {/* ── 구분선 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.divider} />
          </tr>

          {/* ── 유망 섹터 Top 8 ── */}
          <tr className="xls-row">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={6} style={S.sectionTitle}>
              유망 섹터 Top 8
              <span style={{ float: 'right', color: 'var(--color-brand)', cursor: 'pointer', fontSize: 10, fontWeight: 400 }} onClick={() => nav('sectors')}>
                전체 보기 →
              </span>
            </td>
          </tr>

          {/* 섹터 헤더 행 */}
          <tr className="xls-row xls-row--even">
            <td className="xls-row-num">{rowNum()}</td>
            <td className="xls-cell" colSpan={2} style={S.header}>섹터명</td>
            <td className="xls-cell" style={{ ...S.header, ...S.midBorder }}>점수</td>
            <td className="xls-cell" colSpan={2} style={S.header}>섹터명</td>
            <td className="xls-cell" style={S.header}>점수</td>
          </tr>

          {/* 섹터 데이터 행 (4행 × 2열) */}
          {Array.from({ length: 4 }, (_, i) => {
            const s1 = sectors[i * 2]
            const s2 = sectors[i * 2 + 1]
            const c1 = s1?.changeRate ?? s1?.change
            const c2 = s2?.changeRate ?? s2?.change
            return (
              <tr key={i} className={`xls-row${i % 2 === 0 ? '' : ' xls-row--even'}`}>
                <td className="xls-row-num">{rowNum()}</td>

                {/* 섹터 1 이름 */}
                <td className="xls-cell" colSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>
                  {s1 ? (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginRight: 3 }}>#{i * 2 + 1}</span>
                      {s1.name}
                    </>
                  ) : null}
                </td>

                {/* 섹터 1 점수 */}
                <td className="xls-cell" style={{ fontSize: 10, ...S.midBorder }}>
                  {s1 ? (
                    <>
                      <span style={{ color: 'var(--color-brand)', fontWeight: 600 }}>{s1.score}점</span>
                      {c1 != null && (
                        <span style={{ color: changeColor(c1), marginLeft: 4, fontSize: 9 }}>{fmtChange(c1)}</span>
                      )}
                    </>
                  ) : null}
                </td>

                {/* 섹터 2 이름 */}
                <td className="xls-cell" colSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>
                  {s2 ? (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginRight: 3 }}>#{i * 2 + 2}</span>
                      {s2.name}
                    </>
                  ) : null}
                </td>

                {/* 섹터 2 점수 */}
                <td className="xls-cell" style={{ fontSize: 10 }}>
                  {s2 ? (
                    <>
                      <span style={{ color: 'var(--color-brand)', fontWeight: 600 }}>{s2.score}점</span>
                      {c2 != null && (
                        <span style={{ color: changeColor(c2), marginLeft: 4, fontSize: 9 }}>{fmtChange(c2)}</span>
                      )}
                    </>
                  ) : null}
                </td>
              </tr>
            )
          })}

          {/* ── 남는 높이만 채우는 빈 여백 ── */}
          {Array.from({ length: fillerRows }, (_, i) => (
            <tr key={`empty${i}`} className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}`}>
              <td className="xls-row-num">{rowNum()}</td>
              <td className="xls-cell xls-cell--empty" colSpan={6}/>
            </tr>
          ))}

        </tbody>
      </table>
    </div>
  )
}
