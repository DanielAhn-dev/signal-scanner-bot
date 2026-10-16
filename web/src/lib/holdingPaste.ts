/**
 * 보유 종목 여러 줄 붙여넣기 — 한 줄에 "종목명(또는 코드) 수량 평균매수가 [매수일]".
 * 증권사 앱에서 옮겨 적거나 메모장에 써 둔 목록을 한 번에 읽어 미리보기로 보여 주고, 확인한 뒤 저장한다.
 *
 * - 칸 구분은 공백·탭·쉼표 아무거나. 숫자의 천 단위 쉼표와 "주"·"원"은 떼고 읽는다(예: 10주 72,000원).
 * - 종목명에 숫자가 들어가는 경우("KODEX 200")가 있어 뒤에서부터 숫자 2~3개를 떼어 보고,
 *   남은 앞부분이 종목 목록과 정확히 맞는 쪽을 고른다.
 * - 이름이 정확히 맞지 않으면 비슷한 후보만 보여 주고 자동으로 고르지 않는다(후보 1개라도 사용자가 고른다).
 */

export type PasteStock = { code: string; name: string }

export type PastedHolding = {
  line: string
  /** 줄 앞부분에서 읽은 종목 입력 */
  input: string
  code: string | null
  name: string | null
  quantity: number | null
  avgPrice: number | null
  /** YYYY-MM-DD. 줄에 없으면 null(화면의 기본 날짜를 쓴다) */
  buyDate: string | null
  /** 정확히 맞지 않을 때 고를 수 있는 후보(최대 5개) */
  candidates: PasteStock[]
  error: string | null
}

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()

function toNumber(token: string): number | null {
  const t = token.replace(/,/g, '').replace(/(주|원)$/u, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** 6자리(YYMMDD)·8자리(YYYYMMDD)·구분자(YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD) */
export function parsePasteDate(token: string): string | null {
  const t = token.trim().replace(/\.$/, '')
  let y: number, m: number, d: number
  let mt = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t)
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3] }
  else if ((mt = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) { y = +mt[1]; m = +mt[2]; d = +mt[3] }
  else if ((mt = /^(\d{2})(\d{2})(\d{2})$/.exec(t))) { y = 2000 + +mt[1]; m = +mt[2]; d = +mt[3] }
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 1980) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function findStockCandidates(input: string, stocks: PasteStock[], limit = 5): PasteStock[] {
  const q = norm(input)
  if (!q) return []
  return stocks
    .filter((s) => norm(s.name).includes(q) || (q.length >= 2 && q.includes(norm(s.name))) || s.code.startsWith(q))
    .sort((a, b) => Math.abs(norm(a.name).length - q.length) - Math.abs(norm(b.name).length - q.length))
    .slice(0, limit)
}

function exactStock(input: string, byCode: Map<string, PasteStock>, byName: Map<string, PasteStock>): PasteStock | null {
  const q = norm(input)
  return byCode.get(q) ?? byName.get(q) ?? null
}

export function parseHoldingLines(text: string, stocks: PasteStock[], today: string): PastedHolding[] {
  const byCode = new Map(stocks.map((s) => [s.code.toUpperCase(), s]))
  const byName = new Map<string, PasteStock>()
  for (const s of stocks) {
    const k = norm(s.name)
    // 같은 이름이 둘이면 이름으로는 정할 수 없다
    if (byName.has(k)) byName.set(k, { code: '', name: s.name })
    else byName.set(k, s)
  }
  const out: PastedHolding[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // 쉼표는 천 단위일 수도 있어 먼저 공백·탭으로 나누고, 숫자 모양이 아닌 칸만 쉼표로 다시 나눈다
    const words = line.split(/\s+/).flatMap((w) => (/^\d{1,3}(,\d{3})+(\.\d+)?(주|원)?$/u.test(w) ? [w] : w.split(',')))
      .map((w) => w.trim()).filter(Boolean)
    let trailing = 0
    for (let i = words.length - 1; i >= 1 && trailing < 3; i--) {
      if (toNumber(words[i]) == null && parsePasteDate(words[i]) == null) break
      trailing++
    }
    const base: PastedHolding = { line, input: '', code: null, name: null, quantity: null, avgPrice: null, buyDate: null, candidates: [], error: null }
    if (trailing < 2) {
      out.push({ ...base, input: words.join(' '), error: '수량과 평균매수가를 찾지 못했습니다' })
      continue
    }
    // 날짜를 포함한 3칸 → 2칸 순서로, 앞부분이 종목과 정확히 맞는 해석을 고른다
    type Try = { k: number; input: string; qty: number | null; price: number | null; date: string | null; stock: PasteStock | null }
    const tries: Try[] = []
    for (const k of [3, 2]) {
      if (trailing < k || words.length - k < 1) continue
      const tail = words.slice(words.length - k)
      const date = k === 3 ? parsePasteDate(tail[2]) : null
      if (k === 3 && !date) continue
      const input = words.slice(0, words.length - k).join(' ')
      tries.push({ k, input, qty: toNumber(tail[0]), price: toNumber(tail[1]), date, stock: exactStock(input, byCode, byName) })
    }
    const pick = tries.find((t) => t.stock && t.stock.code) ?? tries.find((t) => t.k === 2) ?? tries[0]
    if (!pick) {
      out.push({ ...base, input: words.join(' '), error: '수량과 평균매수가를 찾지 못했습니다' })
      continue
    }
    const row: PastedHolding = { ...base, input: pick.input, quantity: pick.qty, avgPrice: pick.price, buyDate: pick.date }
    if (pick.stock && pick.stock.code) {
      row.code = pick.stock.code
      row.name = pick.stock.name
    } else {
      row.candidates = findStockCandidates(pick.input, stocks)
      row.error = pick.stock ? '같은 이름의 종목이 여러 개입니다. 아래에서 고르세요' : row.candidates.length ? '종목을 정확히 찾지 못했습니다. 아래에서 고르세요' : '종목을 찾지 못했습니다. 코드(6자리)로 적어 주세요'
    }
    if (!row.error) row.error = validateHolding(row, today)
    out.push(row)
  }
  // 같은 종목이 두 번 나오면 둘 다 표시(저장하면 뒤의 줄이 앞의 줄을 덮어쓴다)
  const seen = new Map<string, number>()
  out.forEach((r) => { if (r.code) seen.set(r.code, (seen.get(r.code) ?? 0) + 1) })
  out.forEach((r) => { if (r.code && (seen.get(r.code) ?? 0) > 1 && !r.error) r.error = '같은 종목이 두 번 있습니다. 한 줄로 합쳐 주세요' })
  return out
}

/** 종목이 정해진 줄의 수량·가격·날짜 확인. 문제가 없으면 null */
export function validateHolding(row: Pick<PastedHolding, 'quantity' | 'avgPrice' | 'buyDate'>, today: string): string | null {
  if (row.quantity == null || !Number.isInteger(row.quantity) || row.quantity < 1) return '수량은 1주 이상 정수로 적어 주세요'
  if (row.avgPrice == null || !(row.avgPrice > 0)) return '평균매수가를 0보다 크게 적어 주세요'
  if (row.buyDate && row.buyDate > today) return '매수일이 오늘 이후입니다'
  return null
}
