/**
 * AlertSidePanel — 우측 고정 패널: 실시간 채팅/알림
 */
import React, { useState } from 'react'
import { Send } from 'lucide-react'

type Msg = { user: string; time: string; text: string; mine?: boolean }

const SAMPLE: Msg[] = [
  { user: '금달부장', time: '17:04', text: '오후 부으란 하면 될까요? NMN 이야기가 많이 들어오는데' },
  { user: '주녀',     time: '16:32', text: '나는 결단이다 파느냐마는거야대' },
  { user: '금달부장_7da', time: '16:32', text: '관리하면리마라이면 방법 없나' },
  { user: '우주럭승창거임.73b', time: '16:33', text: '무엇 만들어주서서 감사합니다' },
  { user: '삼성전자채권방', time: '16:33', text: '관리서사 NXT 같은하면써나요...공급 있나요' },
  { user: 'ssamkap',  time: '16:33', text: '저도 된다 모기를에는 궁금합니다' },
  { user: '채권방_60c', time: '16:34', text: '금리 줄는 시간에 맞춰서 약재 더 네주는건 어느 채권한가요?' },
  { user: '우주럭승창거임',  time: '16:34', text: '저도 된다 모기를 겠다고 파일이다' },
  { user: '주우주방',  time: '16:34', text: '마당 관리자 파악하고 있겠어' },
]

export default function AlertSidePanel() {
  const [input, setInput] = useState('')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 패널 헤더 */}
      <div className="xls-panel-header-bar">
        <span>💬 실시간 채팅</span>
        <span style={{ fontSize: 10, color: 'var(--color-brand)' }}>채팅 13명</span>
      </div>

      {/* 채팅 목록 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {SAMPLE.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: '3px 8px',
              borderBottom: '1px solid var(--color-excel-grid-border)',
              fontSize: 10,
              lineHeight: 1.4,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 1 }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 10 }}>
                {msg.user}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9 }}>{msg.time}</span>
            </div>
            <div style={{ color: 'var(--color-text-secondary)', wordBreak: 'keep-all' }}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* 입력창 */}
      <div style={{
        borderTop: '1px solid var(--color-excel-grid-border)',
        padding: '4px 6px',
        display: 'flex',
        gap: 4,
        background: 'var(--color-gray-0)',
        flexShrink: 0,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="채팅 입력..."
          style={{
            flex: 1,
            border: '1px solid var(--color-excel-grid-border)',
            outline: 'none',
            padding: '2px 6px',
            fontSize: 10,
            fontFamily: 'var(--font-family-sans)',
            borderRadius: 0,
          }}
          onKeyDown={e => e.key === 'Enter' && setInput('')}
        />
        <button
          onClick={() => setInput('')}
          style={{
            background: 'var(--color-excel-title-bar)',
            color: '#fff',
            border: 'none',
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Send size={10}/> 전송
        </button>
      </div>
    </div>
  )
}
