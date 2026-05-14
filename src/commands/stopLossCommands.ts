// src/commands/stopLossCommands.ts
// 손절/익절 자동화 텔레그램 명령어

import type { ChatContext } from '../bot/routing/types'
import { createClient } from '@supabase/supabase-js'
import { StopLossTakeProfitService } from '../services/stopLossTakeProfitService'

function formatKrw(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0원'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

function formatPercent(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.00%'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
const supabase = createClient(url!, key!)
const slService = new StopLossTakeProfitService(url!, key!)

/**
 * /손절설정 SAMSUNG -5
 * 종목의 손절선을 -5%로 설정
 */
export async function cmdSetStopLoss(
  ctx: ChatContext,
  tgSend: any,
  args: string
) {
  const chatId = ctx.chatId
  const parts = (args || '').trim().split(/\s+/)

  if (parts.length < 2 || !parts[0]) {
    return tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 형식: /손절설정 종목코드 손절율\n\n예)\n/손절설정 SAMSUNG -5\n/손절설정 005930 -3`,
      parse_mode: 'HTML',
    })
  }

  const code = parts[0].toUpperCase()
  const stopLossPercent = Number(parts[1])

  if (isNaN(stopLossPercent) || stopLossPercent >= 0) {
    return tgSend('sendMessage', {
      chat_id: chatId,
      text: '❌ 손절율은 음수여야 합니다 (예: -5)',
      parse_mode: 'HTML',
    })
  }

  try {
    const { error } = await supabase
      .from('virtual_positions')
      .update({ stop_loss_percent: stopLossPercent })
      .eq('chat_id', chatId)
      .eq('code', code)

    if (error) throw error

    tgSend('sendMessage', {
      chat_id: chatId,
      text: 
        `✅ <b>${code}</b> 손절선 설정 완료\n\n` +
        `📊 손절: <code>${stopLossPercent}%</code>\n` +
        `⏰ 설정 시간: ${new Date().toLocaleString('ko-KR')}`,
      parse_mode: 'HTML',
    })
  } catch (e) {
    tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 오류: ${e instanceof Error ? e.message : String(e)}`,
      parse_mode: 'HTML',
    })
  }
}

/**
 * /익절설정 SAMSUNG 5:50 10:100
 * 익절 목표 설정: +5% 도달 시 50% 매도, +10% 도달 시 100% 매도
 */
export async function cmdSetTakeProfit(
  ctx: ChatContext,
  tgSend: any,
  args: string
) {
  const chatId = ctx.chatId
  const parts = (args || '').trim().split(/\s+/)

  if (parts.length < 2 || !parts[0]) {
    return tgSend('sendMessage', {
      chat_id: chatId,
      text: 
        `❌ 형식: /익절설정 종목코드 목표율:매도비율 [목표율:매도비율 ...]\n\n예)\n` +
        `/익절설정 SAMSUNG 5:50 10:100\n` +
        `/익절설정 005930 3:30 7:70 12:100`,
      parse_mode: 'HTML',
    })
  }

  const code = parts[0].toUpperCase()
  const targetParts = parts.slice(1)

  try {
    const targets = targetParts.map((tp) => {
      const [target, percentage] = tp.split(':').map(Number)
      if (isNaN(target) || isNaN(percentage) || target <= 0 || percentage <= 0 || percentage > 100) {
        throw new Error(`유효하지 않은 목표: ${tp}`)
      }
      return { target, percentage }
    })

    const { error } = await supabase
      .from('virtual_positions')
      .update({ take_profit_targets: targets })
      .eq('chat_id', chatId)
      .eq('code', code)

    if (error) throw error

    const targetText = targets
      .map((t) => `+${t.target}% → ${t.percentage}% 매도`)
      .join('\n')

    tgSend('sendMessage', {
      chat_id: chatId,
      text: 
        `✅ <b>${code}</b> 익절 목표 설정 완료\n\n` +
        `📈 목표:\n${targetText}\n\n` +
        `⏰ 설정 시간: ${new Date().toLocaleString('ko-KR')}`,
      parse_mode: 'HTML',
    })
  } catch (e) {
    tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 오류: ${e instanceof Error ? e.message : String(e)}`,
      parse_mode: 'HTML',
    })
  }
}

/**
 * /자동매매 ON|OFF [종목코드]
 * 자동 손절/익절 활성화/비활성화
 */
export async function cmdAutoTrading(
  ctx: ChatContext,
  tgSend: any,
  args: string
) {
  const chatId = ctx.chatId
  const parts = (args || '').trim().split(/\s+/)

  if (parts.length < 1 || !parts[0]) {
    return tgSend('sendMessage', {
      chat_id: chatId,
      text: 
        `❌ 형식: /자동매매 ON|OFF [종목코드]\n\n예)\n` +
        `/자동매매 ON\n` +
        `/자동매매 OFF SAMSUNG\n` +
        `/자동매매 ON 005930`,
      parse_mode: 'HTML',
    })
  }

  const mode = parts[0].toUpperCase()
  const code = parts[1]?.toUpperCase()
  const enabled = mode === 'ON'

  if (mode !== 'ON' && mode !== 'OFF') {
    return tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ ON 또는 OFF를 입력하세요`,
      parse_mode: 'HTML',
    })
  }

  try {
    let query = supabase
      .from('virtual_positions')
      .update({ auto_trading_enabled: enabled })
      .eq('chat_id', chatId)

    if (code) {
      query = query.eq('code', code)
    }

    const { data, error } = await query.select('code')

    if (error) throw error

    const count = Array.isArray(data) ? data.length : 0
    const codeText = code ? `(<b>${code}</b>)` : '(전체)'

    tgSend('sendMessage', {
      chat_id: chatId,
      text: 
        `✅ 자동매매 ${enabled ? '활성화' : '비활성화'} ${codeText}\n\n` +
        `📊 처리: ${count}개 종목\n` +
        `⏰ 설정 시간: ${new Date().toLocaleString('ko-KR')}`,
      parse_mode: 'HTML',
    })
  } catch (e) {
    tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 오류: ${e instanceof Error ? e.message : String(e)}`,
      parse_mode: 'HTML',
    })
  }
}

/**
 * /수익현황
 * 현재 포트폴리오 상태 조회 (손절/익절 설정 포함)
 */
export async function cmdPortfolioStatus(
  ctx: ChatContext,
  tgSend: any
) {
  const chatId = ctx.chatId

  try {
    const { data: positions } = await supabase
      .from('virtual_positions')
      .select('*')
      .eq('chat_id', chatId)
      .gt('quantity', 0)

    if (!Array.isArray(positions) || positions.length === 0) {
      return tgSend('sendMessage', {
        chat_id: chatId,
        text: '📊 보유 중인 종목이 없습니다',
        parse_mode: 'HTML',
      })
    }

    const { data: snapshot } = await supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('chat_id', chatId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    let text = '📊 <b>포트폴리오 현황</b>\n\n'

    if (snapshot) {
      const riskEmoji =
        snapshot.risk_level === 'RED' ? '🔴' : snapshot.risk_level === 'YELLOW' ? '🟡' : '🟢'
      text += `${riskEmoji} 총 손익: ${formatKrw(snapshot.total_pnl)} (${formatPercent(snapshot.total_pnl_percent)})\n`
      text += `💰 투자액: ${formatKrw(snapshot.total_invested)}\n`
      text += `📈 현재가: ${formatKrw(snapshot.total_current_value)}\n`
      text += `📊 종목수: ${snapshot.position_count}\n\n`
    }

    text += '<b>종목별 설정:</b>\n'

    for (const pos of positions.slice(0, 10)) {
      const stopLoss = pos.stop_loss_percent ? ` | 손절: ${pos.stop_loss_percent}%` : ''
      const autoStatus = pos.auto_trading_enabled ? '✅' : '⛔'

      let tpText = ''
      if (pos.take_profit_targets && Array.isArray(pos.take_profit_targets)) {
        const tpList = (pos.take_profit_targets as any[])
          .map((t) => `+${t.target}%→${t.percentage}%`)
          .join(',')
        tpText = ` | 익절: ${tpList}`
      }

      text += `\n${autoStatus} <b>${pos.code}</b> ×${pos.quantity}\n  ${stopLoss}${tpText}`
    }

    if (positions.length > 10) {
      text += `\n\n... 외 ${positions.length - 10}개 종목`
    }

    tgSend('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    })
  } catch (e) {
    tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 오류: ${e instanceof Error ? e.message : String(e)}`,
      parse_mode: 'HTML',
    })
  }
}

/**
 * /손익리포트 [days]
 * 최근 손절/익절 실행 기록 조회
 */
export async function cmdPnLReport(
  ctx: ChatContext,
  tgSend: any,
  args: string
) {
  const chatId = ctx.chatId
  const days = Number(args) || 7

  try {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const { data: executions } = await supabase
      .from('stop_loss_take_profit_executions')
      .select('*')
      .eq('chat_id', chatId)
      .gte('executed_at', since.toISOString())
      .order('executed_at', { ascending: false })

    if (!Array.isArray(executions) || executions.length === 0) {
      return tgSend('sendMessage', {
        chat_id: chatId,
        text: `📊 최근 ${days}일간 손절/익절 실행이 없습니다`,
        parse_mode: 'HTML',
      })
    }

    let text = `📊 <b>손익 리포트 (최근 ${days}일)</b>\n\n`
    let totalPnL = 0
    let totalCount = 0

    for (const exec of executions) {
      const emoji = exec.execution_type === 'STOP_LOSS' ? '🛑' : '🎯'
      const pnl = Number(exec.execution_pnl || 0)
      totalPnL += pnl
      totalCount++

      text += `${emoji} <b>${exec.code}</b> (${exec.execution_type === 'STOP_LOSS' ? '손절' : '익절'})\n`
      text += `   수량: ${exec.quantity_sold}주 @ ${formatKrw(exec.execution_price)}\n`
      text += `   손익: ${formatKrw(pnl)} ${pnl >= 0 ? '📈' : '📉'}\n`
      text += `   시간: ${new Date(exec.executed_at).toLocaleString('ko-KR')}\n\n`
    }

    text += `<b>총계</b>\n손익: ${formatKrw(totalPnL)} ${totalPnL >= 0 ? '📈' : '📉'}\n건수: ${totalCount}건`

    tgSend('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    })
  } catch (e) {
    tgSend('sendMessage', {
      chat_id: chatId,
      text: `❌ 오류: ${e instanceof Error ? e.message : String(e)}`,
      parse_mode: 'HTML',
    })
  }
}
