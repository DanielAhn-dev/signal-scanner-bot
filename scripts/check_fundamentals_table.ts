import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or service key')
  process.exit(1)
}

const sb = createClient(url, key)

async function checkFundamentalsTables() {
  try {
    console.log('📊 === Checking FUNDAMENTALS TABLE ===')
    const { data: fundamentals, error: fundError, count: fundCount } = await sb
      .from('fundamentals')
      .select('*', { count: 'exact' })
      .limit(3)

    if (fundError) {
      console.error('❌ Error querying fundamentals:', fundError.message)
    } else {
      console.log(`✅ Fundamentals table has ${fundCount} rows`)
      if (fundamentals && fundamentals.length > 0) {
        const sample = fundamentals[0]
        console.log('\n📌 Sample row:')
        console.log(`  code: ${sample.code}`)
        console.log(`  as_of: ${sample.as_of}`)
        console.log(`  per: ${sample.per}`)
        console.log(`  pbr: ${sample.pbr}`)
        console.log(`  eps: ${sample.eps}`)
        console.log(`  bps: ${sample.bps}`)
        console.log(`  roe: ${sample.roe}`)
        console.log(`  debt_ratio: ${sample.debt_ratio}`)
        console.log(`\n  All columns: ${Object.keys(sample).join(', ')}`)
      }
    }

    console.log('\n📊 === Checking STOCKS TABLE ===')
    const { data: stocks, error: stockError, count: stockCount } = await sb
      .from('stocks')
      .select('*', { count: 'exact' })
      .limit(3)

    if (stockError) {
      console.error('❌ Error querying stocks:', stockError.message)
    } else {
      console.log(`✅ Stocks table has ${stockCount} rows`)
      if (stocks && stocks.length > 0) {
        const sample = stocks[0]
        console.log('\n📌 Sample row:')
        console.log(`  code: ${sample.code}`)
        console.log(`  name: ${sample.name}`)
        console.log(`  per: ${sample.per}`)
        console.log(`  pbr: ${sample.pbr}`)
        console.log(`  eps: ${sample.eps}`)
        console.log(`  bps: ${sample.bps}`)
        
        const hasFin = ['per', 'pbr', 'eps', 'bps'].some(k => sample[k] != null)
        console.log(`\n  📋 Financial columns in stocks table: ${hasFin ? 'YES' : 'NO (stored in fundamentals)'}`)
      }
    }

    console.log('\n📊 === LATEST FUNDAMENTALS DATA ===')
    const { data: latest } = await sb
      .from('fundamentals')
      .select('as_of')
      .order('as_of', { ascending: false })
      .limit(1)

    if (latest && latest.length > 0) {
      console.log(`✅ Latest fundamentals as_of: ${latest[0].as_of}`)
    } else {
      console.log('⚠️  No fundamentals data at all')
    }

  } catch (err: any) {
    console.error('Error:', err.message)
    process.exit(1)
  }
}

checkFundamentalsTables().then(() => process.exit(0))
