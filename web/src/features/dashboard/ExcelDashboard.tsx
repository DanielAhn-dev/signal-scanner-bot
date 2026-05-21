/**
 * ExcelDashboard — 메인 대시보드 (3패널 스프레드시트 레이아웃)
 *
 * 좌: 실시간 시세 그리드
 * 중: 뉴스피드 그리드
 * 우: 섹터/신호 그리드
 */
import React, { useState, useEffect } from 'react'
import ExcelLayout, { PanelDef } from '../../components/ExcelLayout'
import ExcelSpreadsheet, { ColDef, RowData } from '../../components/ExcelSpreadsheet'
import { apiFetch } from '../../lib/api'
import { RefreshCw, Plus, Download } from 'lucide-react'

// ── 좌 패널: 실시간 시세 ─────────────────────────────────────────

const MARKET_COLS: ColDef[] = [
  { key: 'label', label: '지표',   width: 120, minWidth: 80 },
  { key: 'price', label: '현재가', width: 90,  minWidth: 70, numeric: true },
  { key: 'daily', label: '일간',   width: 80,  minWidth: 60, numeric: true },
]

const MARKET_STATIC: RowData[] = [
  { _key: 'kospi',  label: '코스피',    price: '2,815.59', daily: '+8.42%',  _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'kosdaq', label: '코스닥',    price: '1,105.97', daily: '+4.73%',  _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'kospi200', label: '코스피200', price: '373.21', daily: '+1.25%',  _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'div1', label: '──────────', price: '', daily: '', _rowStyle: { color: 'var(--color-text-tertiary)', fontStyle: 'italic' } },
  { _key: 'samsung', label: '삼성전자',  price: '296,500', daily: '+7.25%',  _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'skhynix', label: 'SK하이닉스', price: '1,915,000', daily: '+9.74%', _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'lg',      label: 'LG전자',   price: '234,500',  daily: '+29.56%', _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'hyundai', label: '현대지기치', price: '652,000',  daily: '+10.14%', _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'div2', label: '──────────', price: '', daily: '', _rowStyle: { color: 'var(--color-text-tertiary)' } },
  { _key: 'krw',  label: 'KRW/USD',  price: '1,369.40', daily: '-0.12%',  _style: { daily: { color: 'var(--color-stock-down)' } } },
  { _key: 'wti',  label: 'WTI',      price: '78.23',    daily: '+0.34%',  _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'btc',  label: 'BTC(USD)', price: '77,803.92', daily: '+0.70%', _style: { daily: { color: 'var(--color-stock-up)' } } },
  { _key: 'gold', label: '금(USD)',  price: '3,319.40', daily: '-0.38%',  _style: { daily: { color: 'var(--color-stock-down)' } } },
]

function MarketPanel() {
  const [rows, setRows] = useState<RowData[]>(MARKET_STATIC)
  const [selected, setSelected] = useState<{ row: number; col: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 800)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ExcelSpreadsheet
        columns={MARKET_COLS}
        rows={rows}
        selectedCell={selected}
        onCellClick={(row, col) => setSelected({ row, col })}
        minRows={50}
        showLetters
        showRowNumbers
      />
    </div>
  )
}

// ── 중앙 패널: 뉴스피드 ──────────────────────────────────────────

const NEWS_TABS = ['뉴스피드', '국내주식토론', '해외주식토론', '코인이야기', '운영게시판']

const NEWS_COLS: ColDef[] = [
  { key: 'market', label: '시장', width: 44,  minWidth: 40 },
  { key: 'time',   label: '시각', width: 48,  minWidth: 44, numeric: true },
  { key: 'title',  label: '헤드라인', width: 220, minWidth: 140 },
  { key: 'summary',label: '요약', width: 340, minWidth: 120 },
]

const NEWS_SAMPLE: RowData[] = [
  { _key: 'n1', market: '국장', time: '16:53', title: '기관 매수에 역대 최대 606포인트 급등…\'만스피\' 관측 또 나와', summary: '삼성전자 사상 첫 7800원대 등록 상승. 21일 코스피지수가 기관 매수에 힘입어 역대 최대 상승폭(606.64포인트)으로 급등하면서 7800포인트를 돌파하고 재닫혔다.' },
  { _key: 'n2', market: '국장', time: '16:51', title: 'LG생건은 왜 \'토리든 인수\'에서 발을 뺐나', summary: '' },
  { _key: 'n3', market: '국장', time: '16:50', title: '금양, 상장폐지 결정 불복…법원에 효력정지 가처분 신청', summary: '' },
  { _key: 'n4', market: '국장', time: '16:48', title: 'HK이노엔, 오송공장에 970억 투자…케이캡 글로벌 수요 대응', summary: '' },
  { _key: 'n5', market: '국장', time: '16:46', title: '한국산업은행 \'KDB V.Launch 2026 남부권대회\' 사전 개회', summary: '' },
  { _key: 'n6', market: '국장', time: '16:45', title: '삼성 파업 악재 털자…코스피 역대 최대 606포인트 폭등', summary: '' },
  { _key: 'n7', market: '국장', time: '16:43', title: '삼성전자 8%대! 역대 최고가…59만 전자 기나', summary: '' },
  { _key: 'n8', market: '국장', time: '16:42', title: 'RIA 누적 24만좌…벤디아 팔고 삼선스 담은 서학개미들', summary: '' },
  { _key: 'n9', market: '국장', time: '16:41', title: '9년 만에 금가분리 폴리나…이억원 \'디지털자산기본법\'과 연계에 검토', summary: '' },
  { _key: 'n10', market: '국장', time: '16:41', title: '삼전 총파업 업화지만…주가 \'성과급 합의 무효\' 소송 예고', summary: '' },
  { _key: 'n11', market: '국장', time: '16:39', title: 'RIA 가입 24만좌 돌파…엔비디아 팔고 삼선스 산다', summary: '' },
  { _key: 'n12', market: '국장', time: '16:38', title: '코스피 달러지수 증권주도 \'폭락\'…키옥증권 12%대!', summary: '' },
  { _key: 'n13', market: '국장', time: '16:37', title: '매출 50%!·금리 3배!!...합판, 전기차 압세위 \'냉담 의류\' 판 굳은다', summary: '' },
  { _key: 'n14', market: '국장', time: '16:37', title: '코스피, 8.41% 급등에 7800선 회복', summary: '' },
  { _key: 'n15', market: '국장', time: '16:37', title: '금양 \'상폐 헤행 시간 달라\'…법원에 효력정지 가처분 신청', summary: '' },
]

function NewsPanel() {
  const [activeTab, setActiveTab] = useState(0)
  const [selected, setSelected] = useState<{ row: number; col: string } | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 탭 바 */}
      <div className="xls-panel-tabs">
        {NEWS_TABS.map((t, i) => (
          <button
            key={t}
            className={`xls-panel-tab${activeTab === i ? ' xls-panel-tab--active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t}
          </button>
        ))}
      </div>
      {/* 그리드 */}
      <ExcelSpreadsheet
        columns={NEWS_COLS}
        rows={NEWS_SAMPLE}
        selectedCell={selected}
        onCellClick={(row, col) => setSelected({ row, col })}
        minRows={50}
        showLetters
        showRowNumbers
      />
    </div>
  )
}

// ── 우측 패널: 섹터/신호 ─────────────────────────────────────────

const SIGNAL_COLS: ColDef[] = [
  { key: 'sector', label: '섹터',   width: 90,  minWidth: 70 },
  { key: 'score',  label: '점수',   width: 50,  minWidth: 40, numeric: true },
  { key: 'signal', label: '신호',   width: 60,  minWidth: 50 },
  { key: 'change', label: '변동률', width: 70,  minWidth: 55, numeric: true },
]

const SIGNAL_ROWS: RowData[] = [
  { _key: 's1', sector: '반도체',   score: '94', signal: <span className="xls-badge xls-badge--green">매수</span>,  change: '+4.2%', _style: { change: { color: 'var(--color-stock-up)' } } },
  { _key: 's2', sector: '전기차',   score: '87', signal: <span className="xls-badge xls-badge--green">매수</span>,  change: '+3.1%', _style: { change: { color: 'var(--color-stock-up)' } } },
  { _key: 's3', sector: 'AI·소프트', score: '82', signal: <span className="xls-badge xls-badge--blue">관망</span>,   change: '+1.8%', _style: { change: { color: 'var(--color-stock-up)' } } },
  { _key: 's4', sector: '바이오',   score: '71', signal: <span className="xls-badge xls-badge--blue">관망</span>,   change: '+0.5%', _style: { change: { color: 'var(--color-stock-up)' } } },
  { _key: 's5', sector: '금융',     score: '65', signal: <span className="xls-badge xls-badge--flat">중립</span>,   change: '-0.2%', _style: { change: { color: 'var(--color-stock-down)' } } },
  { _key: 's6', sector: '철강',     score: '48', signal: <span className="xls-badge xls-badge--flat">중립</span>,   change: '-1.1%', _style: { change: { color: 'var(--color-stock-down)' } } },
  { _key: 's7', sector: '에너지',   score: '39', signal: <span className="xls-badge xls-badge--orange">주의</span>, change: '-2.3%', _style: { change: { color: 'var(--color-stock-down)' } } },
  { _key: 's8', sector: '화학',     score: '31', signal: <span className="xls-badge xls-badge--orange">주의</span>, change: '-3.4%', _style: { change: { color: 'var(--color-stock-down)' } } },
]

function SignalPanel() {
  const [selected, setSelected] = useState<{ row: number; col: string } | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="xls-panel-tabs">
        <button className="xls-panel-tab xls-panel-tab--active">섹터 신호</button>
        <button className="xls-panel-tab">포트폴리오</button>
        <button className="xls-panel-tab">알림</button>
      </div>
      <ExcelSpreadsheet
        columns={SIGNAL_COLS}
        rows={SIGNAL_ROWS}
        selectedCell={selected}
        onCellClick={(row, col) => setSelected({ row, col })}
        minRows={50}
        showLetters
        showRowNumbers
      />
    </div>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

type Props = { onNavigate?: (r: string) => void }

export default function ExcelDashboard({ onNavigate }: Props) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 1000)
  }

  const PANELS: PanelDef[] = [
    {
      id: 'market',
      label: '📊 실시간 시세',
      initialFlex: 20,
      minPx: 160,
      toolbar: (
        <>
          <button className="xls-toolbar-btn" onClick={handleRefresh} title="새로고침">
            <RefreshCw size={10} className={refreshing ? 'spin' : ''} />
            30초
          </button>
          <button className="xls-toolbar-btn" title="행 추가">
            <Plus size={10} /> 빈 행
          </button>
          <button className="xls-toolbar-btn" title="내보내기">
            <Download size={10} /> 내보내기
          </button>
        </>
      ),
      content: <MarketPanel />,
    },
    {
      id: 'news',
      label: '📰 뉴스피드',
      initialFlex: 55,
      minPx: 200,
      content: <NewsPanel />,
    },
    {
      id: 'signal',
      label: '🎯 섹터 신호',
      initialFlex: 25,
      minPx: 160,
      content: <SignalPanel />,
    },
  ]

  return (
    <ExcelLayout panels={PANELS} />
  )
}
