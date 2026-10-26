/**
 * 증권사 앱 "주문내역" 캡처를 OCR로 읽은 글자에서 체결 내역을 뽑는다.
 *
 * 화면 모양(토스 기준): 날짜 머리글 아래에 종목마다
 *   종목명                    주당 15,900원
 *   10주 구매 완료
 * 가 최신순으로 쌓인다. OCR은 줄 순서·글자를 틀릴 수 있어 아래를 지킨다.
 * - 취소·미체결·접수는 건너뛴다(건수만 센다). 체결 상태를 못 읽은 줄은 오류로 남겨 사용자가 판단하게 한다.
 * - 종목은 이름이 (공백·대소문자 무시) 정확히 맞을 때만 자동으로 정한다. 아니면 비슷한 순으로 후보만 준다.
 *   (후보 1개라도 사용자가 고른다 — 이름 일부만 맞춰 채택하면 오매칭이 난다)
 * - 결과는 오래된 순으로 돌려준다(앱 목록이 최신순이라 뒤집는다). 선입선출 로트가 실제 순서와 맞게.
 */

export type CaptureStock = { code: string; name: string }

export type CapturedTrade = {
  /** OCR이 읽은 종목명 */
  input: string
  code: string | null
  name: string | null
  /** 정확히 맞지 않을 때 고를 후보(비슷한 순, 최대 5개) */
  candidates: CaptureStock[]
  side: 'BUY' | 'SELL' | null
  quantity: number | null
  price: number | null
  /** 날짜 머리글에서 읽은 YYYY-MM-DD. 못 읽었으면 null(화면에서 오늘로 본다) */
  date: string | null
  error: string | null
}

export type CaptureParse = { trades: CapturedTrade[]; skipped: number }

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()

const DATE_RE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/u
const STATUS_RE = /([\d,.]+)\s*주\s*(구매|구입|매수|판매|매도)\s*(미체결|완료|체결|취소|접수)?/u
const PRICE_RE = /(?:주당\s*)?(\d{1,3}(?:[,.]\d{3})+|\d+)\s*원/u

const toInt = (s: string) => {
  const n = Number(s.replace(/[,.]/g, ''))
  return Number.isFinite(n) ? n : null
}

function ymd(year: number, month: number, day: number): string | null {
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** 두 이름의 글자쌍 겹침 비율(0~1). OCR이 한두 글자 틀려도 비슷한 이름이 위로 온다 */
export function nameSimilarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const bx = bigrams(x)
  const by = bigrams(y)
  let hit = 0
  for (const [g, n] of bx) hit += Math.min(n, by.get(g) ?? 0)
  return (2 * hit) / (x.length - 1 + (y.length - 1))
}

/** 겹치는 글자쌍 수를 둘 중 더 긴 쪽으로 나눈다 — 짧은 이름(KODEX 200)이 깨진 긴 글자 안에 다 들어 있다는 이유로 유리해지지 않게 */
function sharedBigramOverlap(input: string, name: string): number {
  const bi = bigrams(norm(input))
  const bn = bigrams(norm(name))
  let hit = 0
  let ti = 0
  let tn = 0
  for (const n of bi.values()) ti += n
  for (const [g, n] of bn) { tn += n; hit += Math.min(n, bi.get(g) ?? 0) }
  const max = Math.max(ti, tn)
  return max ? hit / max : 0
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * 비슷한 종목 후보. OCR은 긴 ETF 이름 뒤쪽을 통째로 못 읽는 일이 많아("KODEX 200타겟위클리커버드콜" → "KODEX 200EIZI…")
 * 앞부분(운용사·지수) 일치, 글자쌍 겹침, 길이, 그리고 이 계좌에 이미 있는 종목을 함께 본다.
 * 어느 것도 자동 채택하지 않는다 — 사용자가 목록에서 고른다.
 */
export function rankStockCandidates(input: string, stocks: CaptureStock[], limit = 6, heldCodes?: Set<string>): CaptureStock[] {
  const x = norm(input)
  if (!x) return []
  return stocks
    .map((s) => {
      const y = norm(s.name)
      const prefix = Math.min(1, commonPrefix(x, y) / Math.min(8, y.length))
      const lengthSim = 1 - Math.abs(x.length - y.length) / Math.max(x.length, y.length)
      const held = heldCodes?.has(s.code) ? 0.15 : 0
      const score = 0.3 * prefix + 0.2 * sharedBigramOverlap(input, s.name) + 0.35 * lengthSim + 0.15 * nameSimilarity(input, s.name) + held
      return { s, score }
    })
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.s)
}

/** 칸별로 읽은 글자 한 건 — captureSegments로 자른 블록의 OCR 결과 */
export type BlockRead =
  | { kind: 'text'; text: string }
  | { kind: 'item'; name: string; price: string; status: string; full: string }

/**
 * 칸별 OCR 결과를 parseTradeCapture가 읽는 평평한 글자로 합친다. 칸별 결과를 먼저 믿고, 안 읽힌 칸만 블록 전체 글자에서 채운다.
 * 이름은 전체 글자의 줄 중 종목명과 정확히 맞는 것이 있으면 그것을, 없으면 이름 칸의 글자를 쓴다.
 */
export function assembleCaptureText(blocks: BlockRead[], stocks: CaptureStock[]): string {
  const known = new Set(stocks.flatMap((s) => [norm(s.name), s.code.toUpperCase()]))
  const lines: string[] = []
  for (const b of blocks) {
    if (b.kind === 'text') { lines.push(...b.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)); continue }
    const fullLines = b.full.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const exact = [b.name, ...fullLines].map((l) => l.trim()).find((l) => known.has(norm(l)))
    const longest = [...fullLines].filter((l) => !STATUS_RE.test(l) && !PRICE_RE.test(l)).sort((p, q) => q.length - p.length)[0] ?? ''
    const name = exact ?? (b.name.trim() || longest)

    const statusMatch = STATUS_RE.exec(b.status) ?? fullLines.map((l) => STATUS_RE.exec(l)).find(Boolean) ?? null
    const status = statusMatch ? statusMatch[0] : ''

    // 가격: 가격 칸에서 가장 긴 숫자 묶음 → 없으면 전체 글자의 가격 줄
    const numbers = (b.price.match(/\d{1,3}(?:[,.]\d{3})+|\d+/g) ?? []).sort((p, q) => q.length - p.length)
    const fromFull = fullLines.map((l) => PRICE_RE.exec(l)).find(Boolean)
    const priceNumber = numbers[0] ?? (fromFull ? fromFull[1] : '')
    const priceText = priceNumber ? `주당 ${priceNumber}원` : ''

    if (name) lines.push(name)
    if (status || priceText) lines.push(`${status} ${priceText}`.trim())
  }
  return lines.join('\n')
}

type Draft = {
  name: string
  date: string | null
  side: 'BUY' | 'SELL' | null
  quantity: number | null
  price: number | null
  state: 'done' | 'skip' | 'unknown' | null
}

export function parseTradeCapture(
  text: string,
  stocks: CaptureStock[],
  today: string,
  opts?: { /** 고른 계좌에 이미 있는 종목 — 후보를 고를 때 위로 올린다 */ heldCodes?: Set<string> },
): CaptureParse {
  const year = Number(today.slice(0, 4))
  const byCode = new Map(stocks.map((s) => [s.code.toUpperCase(), s]))
  const byName = new Map<string, CaptureStock | null>()
  for (const s of stocks) {
    const k = norm(s.name)
    byName.set(k, byName.has(k) ? null : s) // 같은 이름이 둘이면 이름으로 정할 수 없다
  }

  const found: Draft[] = []
  let skipped = 0
  let date: string | null = null
  let cur = null as Draft | null
  let pendingPrice: number | null = null

  const flush = () => {
    if (cur && cur.state) {
      if (cur.state === 'skip') skipped++
      else found.push(cur)
    }
    cur = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    const dm = DATE_RE.exec(line)
    if (dm && !STATUS_RE.test(line)) {
      flush()
      date = ymd(dm[1] ? Number(dm[1]) : year, Number(dm[2]), Number(dm[3])) ?? date
      pendingPrice = null
      continue
    }

    const price = PRICE_RE.exec(line)
    const priceValue = price ? toInt(price[1]) : null
    const sm = STATUS_RE.exec(line)

    if (sm) {
      if (!cur) cur = { name: '', date, side: null, quantity: null, price: pendingPrice, state: null }
      pendingPrice = null
      cur.quantity = toInt(sm[1])
      cur.side = /구매|구입|매수/u.test(sm[2]) ? 'BUY' : 'SELL'
      cur.state = /미체결|취소|접수/u.test(sm[3] ?? '') ? 'skip' : /완료|체결/u.test(sm[3] ?? '') ? 'done' : 'unknown'
      if (priceValue != null && cur.price == null) cur.price = priceValue
      continue
    }

    const rest = (price ? line.replace(price[0], '') : line).trim()
    if ((rest.match(/[가-힣A-Za-z]/g) ?? []).length >= 2) {
      // 종목명 줄 — 앞 종목이 상태까지 읽혔으면 거기서 끊는다
      if (cur?.state) flush()
      cur = { name: rest, date, side: null, quantity: null, price: pendingPrice, state: null }
      pendingPrice = null
      if (priceValue != null && cur.price == null) cur.price = priceValue
    } else if (priceValue != null) {
      // 가격만 있는 줄 — 지금 종목에 아직 가격이 없으면 거기에, 있으면 다음 종목 몫으로 둔다
      if (cur && cur.price == null) cur.price = priceValue
      else pendingPrice = priceValue
    }
  }
  flush()

  const trades: CapturedTrade[] = found.map((d) => {
    const base: CapturedTrade = {
      input: d.name, code: null, name: null, candidates: [],
      side: d.side, quantity: d.quantity, price: d.price, date: d.date, error: null,
    }
    const exact = byCode.get(norm(d.name)) ?? byName.get(norm(d.name)) ?? null
    if (exact && exact.code) {
      base.code = exact.code
      base.name = exact.name
    } else {
      base.candidates = rankStockCandidates(d.name, stocks, 6, opts?.heldCodes)
      base.error = !d.name
        ? '종목명을 읽지 못했습니다. 직접 골라 주세요'
        : exact === null && byName.has(norm(d.name))
          ? '같은 이름의 종목이 여러 개입니다. 아래에서 고르세요'
          : base.candidates.length ? '종목을 정확히 찾지 못했습니다. 아래에서 고르세요' : '종목을 찾지 못했습니다. 이 줄은 빼고 직접 기록해 주세요'
    }
    if (d.state === 'unknown') base.error = base.error ?? '체결 완료인지 읽지 못했습니다. 증권사 앱과 대조해 주세요'
    if (!base.error) base.error = validateCapturedTrade(base, today)
    return base
  })

  return { trades: trades.reverse(), skipped }
}

/** 종목이 정해진 줄의 수량·가격·날짜·매도 가능 여부 확인. 문제가 없으면 null */
export function validateCapturedTrade(
  t: Pick<CapturedTrade, 'side' | 'quantity' | 'price' | 'date'>,
  today: string,
): string | null {
  if (t.quantity == null || !Number.isInteger(t.quantity) || t.quantity < 1) return '수량을 읽지 못했습니다. 1주 이상이어야 합니다'
  if (t.price == null || !(t.price > 0)) return '체결가를 읽지 못했습니다'
  if (t.date && t.date > today) return '체결일이 오늘 이후입니다'
  if (t.date && t.date < today) {
    if (t.side === 'SELL') return '지난 날짜 매도는 기록할 수 없습니다. 이 줄은 빼 주세요'
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.date}T00:00:00Z`)) / 86_400_000
    if (days > 7) return '체결일이 7일보다 오래됐습니다. 이 줄은 빼 주세요'
  }
  return null
}
