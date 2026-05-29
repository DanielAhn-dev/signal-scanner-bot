import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const REPORT_SHARE_TABLE = 'ui_report_shares'

export type StoredReportShare = {
  shareId: string
  publicToken: string
  topic: string
  inviteCode: string
  reportDate: string
  audienceKey: string
  bodyText: string
  sourceLabel: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
}

function hashInviteCode(secret: string, inviteCode: string): string {
  return crypto.createHmac('sha256', secret).update(inviteCode.trim().toUpperCase()).digest('hex')
}

function hashShareAccessToken(secret: string, accessToken: string): string {
  return crypto.createHmac('sha256', secret).update(accessToken.trim()).digest('hex')
}

function randomAlphaNumeric(length: number): string {
  return crypto.randomBytes(length * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, length).toUpperCase()
}

function randomToken(length = 24): string {
  return crypto.randomBytes(length).toString('base64url')
}

export function generateInviteCode(): string {
  return randomAlphaNumeric(6)
}

export function generatePublicShareToken(): string {
  return randomToken(18)
}

export function generateShareAccessToken(): string {
  return randomToken(24)
}

export function generateShareId(): string {
  return `shr_${randomToken(12)}`
}

export async function createReportShare(params: {
  supabase: SupabaseClient
  secret: string
  topic: string
  reportDate: string
  audienceKey: string
  bodyText: string
  sourceLabel: string
  expiresAt: string
}): Promise<StoredReportShare> {
  const { supabase, secret, topic, reportDate, audienceKey, bodyText, sourceLabel, expiresAt } = params
  const inviteCode = generateInviteCode()
  const shareId = generateShareId()
  const publicToken = generatePublicShareToken()
  const inviteCodeHash = hashInviteCode(secret, inviteCode)

  const { error: revokeError } = await supabase
    .from(REPORT_SHARE_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('topic', topic)
    .eq('report_date', reportDate)
    .eq('audience_key', audienceKey)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())

  if (revokeError) throw revokeError

  const payload = {
    id: shareId,
    public_token: publicToken,
    topic,
    report_date: reportDate,
    audience_key: audienceKey,
    invite_code_hash: inviteCodeHash,
    body_text: bodyText,
    source_label: sourceLabel,
    expires_at: expiresAt,
  }

  const { error } = await supabase.from(REPORT_SHARE_TABLE).insert(payload)
  if (error) throw error

  return {
    shareId,
    publicToken,
    topic,
    inviteCode,
    reportDate,
    audienceKey,
    bodyText,
    sourceLabel,
    expiresAt,
  }
}

export async function listReportShares(params: {
  supabase: SupabaseClient
  topic?: string
  audienceKey?: string
  activeOnly?: boolean
  limit?: number
}) {
  const { supabase, topic, audienceKey, activeOnly = true, limit = 20 } = params
  let query = supabase
    .from(REPORT_SHARE_TABLE)
    .select('id,public_token,topic,report_date,audience_key,source_label,expires_at,created_at,revoked_at,access_count,last_accessed_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (topic) query = query.eq('topic', topic)
  if (audienceKey) query = query.eq('audience_key', audienceKey)
  if (activeOnly) {
    query = query.is('revoked_at', null).gt('expires_at', new Date().toISOString())
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => ({
    shareId: String(row.id),
    publicToken: String(row.public_token),
    topic: String(row.topic),
    reportDate: String(row.report_date),
    audienceKey: String(row.audience_key),
    sourceLabel: String(row.source_label || ''),
    expiresAt: String(row.expires_at),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    accessCount: Number(row.access_count || 0),
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
  }))
}

export async function revokeReportShare(params: {
  supabase: SupabaseClient
  shareId: string
}) {
  const { supabase, shareId } = params
  const { error } = await supabase
    .from(REPORT_SHARE_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
    .is('revoked_at', null)
  if (error) throw error
}

export async function revokeReportSharesByScope(params: {
  supabase: SupabaseClient
  topic: string
  audienceKey?: string
}) {
  const { supabase, topic, audienceKey } = params
  let query = supabase
    .from(REPORT_SHARE_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('topic', topic)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())

  if (audienceKey) query = query.eq('audience_key', audienceKey)

  const { data, error } = await query.select('id')
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

export async function getReportShareByPublicToken(params: {
  supabase: SupabaseClient
  publicToken: string
}) {
  const { supabase, publicToken } = params
  const { data, error } = await supabase
    .from(REPORT_SHARE_TABLE)
    .select('id,public_token,topic,report_date,audience_key,invite_code_hash,claimer_token_hash,claimed_at,body_text,source_label,expires_at,created_at,revoked_at,access_count,last_accessed_at')
    .eq('public_token', publicToken)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data
}

export function verifyInviteCode(params: {
  secret: string
  inviteCode: string
  inviteCodeHash: string
}): boolean {
  const actual = hashInviteCode(params.secret, params.inviteCode)
  const expected = params.inviteCodeHash
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

export function verifyShareAccessToken(params: {
  secret: string
  accessToken: string
  accessTokenHash: string
}): boolean {
  const actual = hashShareAccessToken(params.secret, params.accessToken)
  const expected = params.accessTokenHash
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function claimReportShareAccess(params: {
  supabase: SupabaseClient
  shareId: string
  accessCount: number
  claimerTokenHash: string
}) {
  const { supabase, shareId, accessCount, claimerTokenHash } = params
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from(REPORT_SHARE_TABLE)
    .update({
      claimer_token_hash: claimerTokenHash,
      claimed_at: nowIso,
      access_count: accessCount + 1,
      last_accessed_at: nowIso,
    })
    .eq('id', shareId)
    .is('claimer_token_hash', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

export function hashShareAccessTokenForStorage(secret: string, accessToken: string): string {
  return hashShareAccessToken(secret, accessToken)
}

export async function markReportShareAccessed(params: {
  supabase: SupabaseClient
  shareId: string
  accessCount: number
}) {
  const { supabase, shareId, accessCount } = params
  const { error } = await supabase
    .from(REPORT_SHARE_TABLE)
    .update({
      access_count: accessCount + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq('id', shareId)
  if (error) throw error
}
