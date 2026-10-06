import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SHARES, acceptCoupleCode, createCoupleCode, endCouple, getHousehold, isCodeUsable, isCoupleCode, normalizeShares,
  parseSharesPatch, partnerSharing, redeemCoupleSignup, setMyShares, sidesOf,
} from '../src/services/household'

// ── 메모리 안의 작은 Supabase 흉내. household.ts·invites.ts가 쓰는 호출만 지원한다.
// rpc는 db/migrations/029_household_links.sql 함수와 같은 규칙으로 흉내 낸다(SQL 자체는 여기서 검증하지 않는다).
type Row = Record<string, any>
function fakeDb(seed: Record<string, Row[]> = {}, opts: { failProfileInsert?: boolean } = {}) {
  const tables: Record<string, Row[]> = { household_links: [], household_members: [], web_user_profiles: [], web_invites: [], web_invite_config: [], users: [], ...seed }
  let seq = 0
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let op: { kind: 'select' | 'update' | 'insert' | 'upsert'; payload?: any; count?: boolean } = { kind: 'select' }
    let selectAfter = false
    let order: [string, boolean] | null = null
    let limitN: number | null = null
    const rows = () => (tables[table] ??= [])
    const run = () => {
      if (op.kind === 'insert' || op.kind === 'upsert') {
        const list = Array.isArray(op.payload) ? op.payload : [op.payload]
        if (table === 'web_user_profiles' && op.kind === 'insert' && opts.failProfileInsert) return { data: null, error: { message: 'fail' } }
        const added = list.map((p: Row) => ({ id: `id-${++seq}`, status: table === 'household_links' ? 'pending' : table === 'web_invites' ? 'open' : undefined, created_at: new Date(Date.now() + seq).toISOString(), inviter_shares: DEFAULT_SHARES, invitee_shares: DEFAULT_SHARES, ...p }))
        rows().push(...added)
        return { data: selectAfter ? added[0] : null, error: null }
      }
      let hit = rows().filter((r) => filters.every((f) => f(r)))
      if (op.kind === 'update') {
        hit.forEach((r) => Object.assign(r, op.payload))
        return { data: selectAfter ? hit[0] ?? null : null, error: null }
      }
      if (order) { const [k, asc] = order; hit = [...hit].sort((a, b) => (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1)) }
      if (limitN !== null) hit = hit.slice(0, limitN)
      return { data: hit, error: null, count: hit.length }
    }
    const b: any = {
      select: (_cols?: string, o?: { count?: string }) => { if (op.kind === 'select') op = { kind: 'select', count: !!o?.count }; else selectAfter = true; return b },
      update: (payload: any) => { op = { kind: 'update', payload }; return b },
      insert: (payload: any) => { op = { kind: 'insert', payload }; return b },
      upsert: (payload: any) => { op = { kind: 'upsert', payload }; return b },
      eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return b },
      gt: (k: string, v: any) => { filters.push((r) => r[k] > v); return b },
      is: (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return b },
      order: (k: string, o?: { ascending?: boolean }) => { order = [k, o?.ascending !== false]; return b },
      limit: (n: number) => { limitN = n; return b },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error } },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    }
    return b
  }
  const rpc = async (fn: string, args: any) => {
    const links = tables.household_links
    const members = tables.household_members
    if (fn === 'accept_household_link') {
      const l = links.find((r) => r.code === args.p_code)
      if (!l) return { data: { ok: false, reason: 'invalid_code' }, error: null }
      if (l.inviter_client_id === args.p_client_id) return { data: { ok: false, reason: 'own_code' }, error: null }
      if (l.status !== 'pending' || new Date(l.expires_at).getTime() <= Date.now()) return { data: { ok: false, reason: 'used_or_expired' }, error: null }
      if (members.some((m) => [l.inviter_client_id, args.p_client_id].includes(m.client_id))) return { data: { ok: false, reason: 'already_linked' }, error: null }
      members.push({ client_id: l.inviter_client_id, link_id: l.id }, { client_id: args.p_client_id, link_id: l.id })
      Object.assign(l, { status: 'active', invitee_client_id: args.p_client_id, accepted_at: new Date().toISOString() })
      links.filter((r) => r.status === 'pending' && r.id !== l.id && [l.inviter_client_id, args.p_client_id].includes(r.inviter_client_id)).forEach((r) => { r.status = 'cancelled' })
      return { data: { ok: true, link_id: l.id }, error: null }
    }
    if (fn === 'end_household_link') {
      const m = members.find((r) => r.client_id === args.p_client_id)
      if (!m) return { data: { ok: false, reason: 'not_linked' }, error: null }
      tables.household_members = members.filter((r) => r.link_id !== m.link_id)
      const l = links.find((r) => r.id === m.link_id)
      if (l?.status === 'active') Object.assign(l, { status: 'ended', ended_by_client_id: args.p_client_id })
      return { data: { ok: true }, error: null }
    }
    return { data: null, error: { message: 'unknown rpc' } }
  }
  return { from: query, rpc, tables }
}

const member = (clientId: string) => ({ client_id: clientId, telegram_id: 1000 + clientId.length })

test('공유 범위: 기본은 모두 공유, 명시적으로 false만 끈다. 변경 입력은 알려진 키·불리언만', () => {
  assert.deepEqual(normalizeShares(undefined), DEFAULT_SHARES)
  assert.deepEqual(normalizeShares({ investing: false }), { spending: true, investing: false, children: true })
  assert.deepEqual(parseSharesPatch({ spending: false }), { spending: false })
  assert.equal(parseSharesPatch({ spending: 'no' }), null)
  assert.equal(parseSharesPatch({ secret: true }), null)
  assert.equal(parseSharesPatch({}), null)
  assert.equal(parseSharesPatch([true]), null)
})

test('연결 행에서 나와 상대를 가르고, 상대의 공유 설정을 상대 칸에서 읽는다', () => {
  const row = { inviter_client_id: 'a', invitee_client_id: 'b', inviter_shares: { investing: false }, invitee_shares: { children: false } }
  assert.deepEqual(sidesOf(row, 'a'), { partnerClientId: 'b', myShares: { spending: true, investing: false, children: true }, partnerShares: { spending: true, investing: true, children: false }, myColumn: 'inviter_shares' })
  assert.equal(sidesOf(row, 'b').partnerShares.investing, false)
  assert.equal(sidesOf(row, 'b').myColumn, 'invitee_shares')
  const now = Date.parse('2026-10-06T00:00:00Z')
  assert.equal(isCodeUsable({ status: 'pending', expires_at: '2026-10-07T00:00:00Z' }, now), true)
  assert.equal(isCodeUsable({ status: 'pending', expires_at: '2026-10-05T00:00:00Z' }, now), false)
  assert.equal(isCodeUsable({ status: 'active', expires_at: '2026-10-07T00:00:00Z' }, now), false)
})

test('이미 가입한 두 사람: 코드 만들기 → 수락 → 서로 보임 → 공유 끄기 → 끊기', async () => {
  const db = fakeDb({ web_user_profiles: [member('a'), member('b')] })
  const created = await createCoupleCode(db, 'a')
  assert.equal(created.ok, true)
  const code = (created as any).code
  assert.match(code, /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/)
  assert.equal((await getHousehold(db, 'a')).status, 'pending')
  assert.equal(await isCoupleCode(db, code.toLowerCase()), true)

  // 자기 코드는 못 쓴다
  assert.deepEqual(await acceptCoupleCode(db, 'a', code), { ok: false, reason: 'own_code' })
  assert.deepEqual(await acceptCoupleCode(db, 'b', code), { ok: true })
  const viewA = await getHousehold(db, 'a')
  assert.equal(viewA.status, 'active')
  assert.equal(viewA.status === 'active' && viewA.partnerClientId, 'b')
  assert.equal(await partnerSharing(db, 'b', 'spending'), 'a')
  // 같은 코드 재사용 불가
  assert.deepEqual(await acceptCoupleCode(db, 'c', code), { ok: false, reason: 'used_or_expired' })

  // a가 투자를 끄면 b에게서만 사라진다
  assert.equal((await setMyShares(db, 'a', { investing: false })).ok, true)
  assert.equal(await partnerSharing(db, 'b', 'investing'), null)
  assert.equal(await partnerSharing(db, 'a', 'investing'), 'b')

  // 연결된 동안 새 코드는 못 만든다
  assert.deepEqual(await createCoupleCode(db, 'a'), { ok: false, reason: 'already_linked' })

  // b가 끊으면 둘 다 연결 없음
  assert.deepEqual(await endCouple(db, 'b'), { ok: true })
  assert.equal((await getHousehold(db, 'a')).status, 'none')
  assert.equal(await partnerSharing(db, 'a', 'spending'), null)
  assert.deepEqual(await endCouple(db, 'b'), { ok: false, reason: 'not_linked' })
})

test('새 코드를 만들면 이전 대기 코드는 무효, 다른 사람과 연결된 사람은 수락 못 한다', async () => {
  const db = fakeDb({ web_user_profiles: [member('a'), member('b'), member('c'), member('d')] })
  const first = (await createCoupleCode(db, 'a') as any).code
  const second = (await createCoupleCode(db, 'a') as any).code
  assert.deepEqual(await acceptCoupleCode(db, 'b', first), { ok: false, reason: 'used_or_expired' })
  assert.deepEqual(await acceptCoupleCode(db, 'b', second), { ok: true })
  const other = (await createCoupleCode(db, 'c') as any).code
  assert.deepEqual(await acceptCoupleCode(db, 'b', other), { ok: false, reason: 'already_linked' })
  assert.deepEqual(await acceptCoupleCode(db, 'd', 'nope'), { ok: false, reason: 'invalid_code' })
})

test('기간이 지난 코드는 못 쓴다', async () => {
  const db = fakeDb({ web_user_profiles: [member('a'), member('b')] })
  const code = (await createCoupleCode(db, 'a', Date.now() - 8 * 86_400_000) as any).code
  assert.deepEqual(await acceptCoupleCode(db, 'b', code), { ok: false, reason: 'used_or_expired' })
})

test('가입 전인 사람: 코드로 가입하면서 연결된다(초대권 불필요), 가입 중단·정원은 따른다', async () => {
  const db = fakeDb({ web_user_profiles: [member('a')] })
  const code = (await createCoupleCode(db, 'a') as any).code
  const joined = await redeemCoupleSignup(db, 'new', code)
  assert.equal(joined.ok, true)
  assert.ok(db.tables.web_user_profiles.some((r) => r.client_id === 'new' && r.joined_via === 'couple' && r.invited_by_client_id === 'a'))
  assert.equal(await partnerSharing(db, 'a', 'children'), 'new')

  const closed = fakeDb({ web_user_profiles: [member('a')], web_invite_config: [{ key: 'signups_open', value: false }] })
  const code2 = (await createCoupleCode(closed, 'a') as any).code
  assert.deepEqual(await redeemCoupleSignup(closed, 'new', code2), { ok: false, reason: 'signups_closed' })
  assert.equal(closed.tables.household_members.length, 0)

  const full = fakeDb({ web_user_profiles: [member('a')], web_invite_config: [{ key: 'max_members', value: 1 }] })
  const code3 = (await createCoupleCode(full, 'a') as any).code
  assert.deepEqual(await redeemCoupleSignup(full, 'new', code3), { ok: false, reason: 'full' })
})

test('가입 처리에 실패하면 잡아 둔 연결을 되돌린다', async () => {
  const db = fakeDb({ web_user_profiles: [member('a')] }, { failProfileInsert: true })
  const code = (await createCoupleCode(db, 'a') as any).code
  assert.deepEqual(await redeemCoupleSignup(db, 'new', code), { ok: false, reason: 'server_error' })
  assert.equal(db.tables.household_members.length, 0)
  assert.equal(await partnerSharing(db, 'a', 'spending'), null)
})

test('이미 회원이면 가입 경로로 들어와도 바로 연결만 한다', async () => {
  const db = fakeDb({ web_user_profiles: [member('a'), member('b')] })
  const code = (await createCoupleCode(db, 'a') as any).code
  assert.deepEqual(await redeemCoupleSignup(db, 'b', code), { ok: true })
  assert.equal(db.tables.web_user_profiles.length, 2)
})
