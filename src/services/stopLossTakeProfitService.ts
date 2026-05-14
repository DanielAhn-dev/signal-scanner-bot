// src/services/stopLossTakeProfitService.ts
// 손절/익절 자동 실행 서비스

import { createClient } from '@supabase/supabase-js'
type VirtualPosition = {
  id?: number
  code?: string
  buy_price?: number
  quantity?: number
  invested_amount?: number
  stop_loss_percent?: number
  take_profit_targets?: Array<{ target: number; percentage: number }>
  auto_trading_enabled?: boolean
  entry_date?: string
}

interface PositionWithPnL extends VirtualPosition {
  current_price?: number
  pnl_amount?: number
  pnl_percent?: number
}

export class StopLossTakeProfitService {
  private supabase: any

  constructor(url: string, key: string) {
    this.supabase = createClient<any, any, any>(url, key)
  }

  /**
   * 포지션의 현재 가격 기준 수익률 계산
   */
  private calculatePnL(position: VirtualPosition, currentPrice: number) {
    const buyPrice = Number(position.buy_price || 0)
    if (buyPrice <= 0) return { pnl_amount: 0, pnl_percent: 0 }

    const quantity = Number(position.quantity || 0)
    const pnl_amount = (currentPrice - buyPrice) * quantity
    const pnl_percent = ((currentPrice - buyPrice) / buyPrice) * 100

    return { pnl_amount, pnl_percent }
  }

  /**
   * 포지션이 손절 조건을 만족하는지 확인
   */
  private shouldExecuteStopLoss(
    position: PositionWithPnL,
    stopLossPercent?: number
  ): { should: boolean; reason: string } {
    const stopLoss = stopLossPercent ?? -5 // 기본값: -5%

    if (position.pnl_percent === undefined) {
      return { should: false, reason: 'no_pnl_data' }
    }

    if (position.pnl_percent <= stopLoss) {
      return { should: true, reason: `hit_stop_loss_${stopLoss}` }
    }

    return { should: false, reason: 'above_stop_loss' }
  }

  /**
   * 포지션이 익절 조건을 만족하는지 확인
   */
  private shouldExecuteTakeProfit(
    position: PositionWithPnL,
    takeProfitTargets?: Array<{ target: number; percentage: number }>
  ): { should: boolean; target?: number; percentage?: number; reason: string } {
    if (position.pnl_percent === undefined) {
      return { should: false, reason: 'no_pnl_data' }
    }

    const targets = takeProfitTargets ?? [
      { target: 5, percentage: 50 },
      { target: 10, percentage: 100 },
    ]

    // 역순으로 확인 (높은 목표부터)
    for (const t of [...targets].reverse()) {
      if (position.pnl_percent >= t.target) {
        return {
          should: true,
          target: t.target,
          percentage: t.percentage,
          reason: `hit_take_profit_${t.target}`,
        }
      }
    }

    // 시간 기반 익절 확인 (28일 이상 보유)
    if (position.entry_date) {
      const entryDate = new Date(position.entry_date)
      const now = new Date()
      const daysDiff = (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
      if (daysDiff >= 28) {
        return {
          should: true,
          target: 0,
          percentage: 100,
          reason: 'time_exit_28days',
        }
      }
    }

    return { should: false, reason: 'above_all_targets' }
  }

  /**
   * 포지션 자동 청산 실행
   */
  async executeAutoExit(
    chatId: bigint,
    position: PositionWithPnL,
    exitType: 'STOP_LOSS' | 'TAKE_PROFIT',
    exitReason: string,
    saleQuantity: number,
    salePrice: number
  ) {
    try {
      // 1) 매도 거래 기록
      const trade = await this.supabase
        .from('virtual_trades')
        .insert([
          {
            chat_id: chatId,
            code: position.code,
            side: 'SELL',
            price: salePrice,
            quantity: saleQuantity,
            gross_amount: saleQuantity * salePrice,
            net_amount: saleQuantity * salePrice,
            fee_amount: 0,
            tax_amount: 0,
            memo: `[${exitType}] ${exitReason}`,
          },
        ])
        .select()
        .single()

      if (trade.error) {
        console.error('Failed to create SELL trade:', trade.error)
        return null
      }

      // 2) 손절/익절 실행 기록
      const buyPrice = Number(position.buy_price || salePrice)
      const pnl = (salePrice - buyPrice) * saleQuantity

      await this.supabase.from('stop_loss_take_profit_executions').insert([
        {
          chat_id: chatId,
          position_id: position.id,
          code: position.code,
          execution_type: exitType,
          trigger_reason: exitReason,
          quantity_sold: saleQuantity,
          execution_price: salePrice,
          execution_pnl: pnl,
        },
      ])

      return {
        success: true,
        trade: trade.data,
        pnl,
      }
    } catch (e) {
      console.error('Error executing auto exit:', e)
      return null
    }
  }

  /**
   * 포트폴리오 전체 검사 및 자동화된 손절/익절 실행
   */
  async checkAndExecuteAllPositions(
    chatId: bigint,
    priceMap: Map<string, number> // { code: current_price }
  ) {
    try {
      // 1) 활성 포지션 조회
      const { data: positions, error: posErr } = await this.supabase
        .from('virtual_positions')
        .select('*')
        .eq('chat_id', chatId)
        .gt('quantity', 0)
        .eq('auto_trading_enabled', true)

      if (posErr) throw posErr

      if (!Array.isArray(positions) || positions.length === 0) {
        return { executed: [], message: 'No active positions' }
      }

      const executed: any[] = []

      for (const pos of positions) {
        const currentPrice = priceMap.get(String(pos.code))
        if (!currentPrice) continue

        // PnL 계산
        const pnlCalc = this.calculatePnL(pos, currentPrice)
        const posWithPnL: PositionWithPnL = {
          ...pos,
          current_price: currentPrice,
          pnl_amount: pnlCalc.pnl_amount,
          pnl_percent: pnlCalc.pnl_percent,
        }

        // 손절 확인
        const slCheck = this.shouldExecuteStopLoss(posWithPnL, pos.stop_loss_percent)
        if (slCheck.should) {
          const result = await this.executeAutoExit(
            chatId,
            posWithPnL,
            'STOP_LOSS',
            slCheck.reason,
            Number(pos.quantity || 0),
            currentPrice
          )
          if (result) executed.push({ code: pos.code, type: 'STOP_LOSS', result })
          continue // 손절 실행 후 익절 체크 스킵
        }

        // 익절 확인
        const tpCheck = this.shouldExecuteTakeProfit(
          posWithPnL,
          pos.take_profit_targets
        )
        if (tpCheck.should) {
          const saleQty = Math.floor(
            (Number(pos.quantity || 0) * (tpCheck.percentage || 100)) / 100
          )
          if (saleQty > 0) {
            const result = await this.executeAutoExit(
              chatId,
              posWithPnL,
              'TAKE_PROFIT',
              tpCheck.reason,
              saleQty,
              currentPrice
            )
            if (result) executed.push({ code: pos.code, type: 'TAKE_PROFIT', result })
          }
        }
      }

      // 포트폴리오 스냅샷 저장
      await this.savePortfolioSnapshot(chatId)

      return { executed, message: `Processed ${positions.length} positions` }
    } catch (e) {
      console.error('Error checking positions:', e)
      throw e
    }
  }

  /**
   * 포트폴리오 스냅샷 저장 (일일)
   */
  async savePortfolioSnapshot(
    chatId: bigint,
    priceMap?: Map<string, number>
  ) {
    try {
      const { data: positions } = await this.supabase
        .from('virtual_positions')
        .select('*')
        .eq('chat_id', chatId)
        .gt('quantity', 0)

      if (!Array.isArray(positions) || positions.length === 0) return

      let totalInvested = 0
      let totalCurrent = 0
      let riskLevel = 'GREEN'
      let maxLoss = 0

      for (const pos of positions) {
        const invested = Number(pos.invested_amount || 0)
        totalInvested += invested

        if (priceMap) {
          const current = Number(pos.quantity || 0) * (priceMap.get(String(pos.code)) || 0)
          totalCurrent += current

          const pnlPct = ((current - invested) / invested) * 100
          if (pnlPct < maxLoss) maxLoss = pnlPct
        }
      }

      if (maxLoss < -5) riskLevel = 'RED'
      else if (maxLoss < -3) riskLevel = 'YELLOW'

      const totalPnL = totalCurrent - totalInvested
      const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

      await this.supabase.from('portfolio_snapshots').upsert(
        [
          {
            chat_id: chatId,
            snapshot_date: new Date().toISOString().slice(0, 10),
            total_invested: totalInvested,
            total_current_value: totalCurrent,
            total_pnl: totalPnL,
            total_pnl_percent: totalPnLPct,
            position_count: positions.length,
            risk_level: riskLevel,
          },
        ],
        { onConflict: 'chat_id,snapshot_date' }
      )
    } catch (e) {
      console.error('Error saving portfolio snapshot:', e)
    }
  }
}
