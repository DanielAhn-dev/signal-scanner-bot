import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or service key')
  process.exit(1)
}

const sb = createClient(url, key)

async function checkSpecificStock(code: string) {
  try {
    console.log(`\n📍 === Checking STOCK: ${code} ===\n`)

    // Check stocks table
    const { data: stockData } = await sb
      .from('stocks')
      .select('*')
      .eq('code', code)
      .single()

    console.log('📊 STOCKS table data:')
    if (stockData) {
      console.log(`  code: ${stockData.code}`)
      console.log(`  name: ${stockData.name}`)
      console.log(`  close: ${stockData.close}`)
      console.log(`  market_cap: ${stockData.market_cap}`)
      console.log(`  per: ${stockData.per}`)
      console.log(`  pbr: ${stockData.pbr}`)
      console.log(`  eps: ${stockData.eps}`)
      console.log(`  bps: ${stockData.bps}`)
      console.log(`  roe: ${stockData.roe}`)
      console.log(`  debt_ratio: ${stockData.debt_ratio}`)
      console.log(`  foreign_ratio: ${stockData.foreign_ratio}`)
      console.log(`  sma20: ${stockData.sma20}`)
      console.log(`  sma50: ${stockData.sma50}`)
      console.log(`  rsi14: ${stockData.rsi14}`)
      console.log(`  updated_at: ${stockData.updated_at}`)
    } else {
      console.log(`  ❌ Not found in stocks table`)
    }

    // Check fundamentals table
    console.log('\n📊 FUNDAMENTALS table latest data:')
    const { data: fundData } = await sb
      .from('fundamentals')
      .select('*')
      .eq('code', code)
      .order('as_of', { ascending: false })
      .limit(1)

    if (fundData && fundData.length > 0) {
      const row = fundData[0]
      console.log(`  code: ${row.code}`)
      console.log(`  as_of: ${row.as_of}`)
      console.log(`  period_type: ${row.period_type}`)
      console.log(`  period_end: ${row.period_end}`)
      console.log(`  per: ${row.per}`)
      console.log(`  pbr: ${row.pbr}`)
      console.log(`  eps: ${row.eps}`)
      console.log(`  bps: ${row.bps}`)
      console.log(`  roe: ${row.roe}`)
      console.log(`  debt_ratio: ${row.debt_ratio}`)
      console.log(`  sales: ${row.sales}`)
      console.log(`  operating_income: ${row.operating_income}`)
      console.log(`  net_income: ${row.net_income}`)
    } else {
      console.log(`  ⚠️  No fundamentals data for this stock`)
    }

  } catch (err: any) {
    console.error('Error:', err.message)
    process.exit(1)
  }
}

const code = process.argv[2] || '005930'  // Default: Samsung Electronics
checkSpecificStock(code).then(() => process.exit(0))
