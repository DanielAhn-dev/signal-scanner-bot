import type { VercelRequest, VercelResponse } from '@vercel/node'
import { spawn } from 'node:child_process'
import { finishSyncJob, startSyncJob, updateSyncJob } from './_syncState'

const ORIGIN = process.env.UI_CORS_ORIGIN || ''

function resolveCorsOrigin(req: VercelRequest): string {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  if (requestOrigin && trustedOrigins.includes(requestOrigin)) return requestOrigin
  return trustedOrigins[0] || ORIGIN || '*'
}

type SyncPipelineKey = 'dbview-default' | 'score-sync' | 'full-refresh' | 'data-full-sync' | 'intraday-refresh'

const ALLOWLISTED_PIPELINES: Record<SyncPipelineKey, string[]> = {
  'dbview-default': [
    'pnpm exec tsx scripts/_syncSectors.ts',
    'pnpm exec tsx scripts/_syncSectorsToStocks.ts',
  ],
  'score-sync': [
    'pnpm run sync:scores',
  ],
  'full-refresh': [
    'pnpm exec tsx scripts/_syncSectors.ts',
    'pnpm exec tsx scripts/_syncSectorsToStocks.ts',
    'pnpm run sync:scores',
  ],
  // OHLCV 수집 제외, DB에 있는 데이터 기준으로 지표/섹터/점수 전체 재계산
  // ENABLE_WEB_SCRIPT_RUNNER=true + 로컬 Python 환경 필요
  'data-full-sync': [
    'pnpm exec tsx scripts/_syncSectors.ts',
    'pnpm exec tsx scripts/_syncSectorsToStocks.ts',
    'python scripts/daily_batch.py --skip-ohlcv',
  ],
  'intraday-refresh': [
    'pnpm exec tsx scripts/intraday_pullback_signals.ts',
  ],
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

function resolveInternalBase(req: VercelRequest): string {
  const override = String(process.env.INTERNAL_API_BASE || process.env.UI_INTERNAL_API_BASE || '').trim()
  if (override) return override.replace(/\/$/, '')

  if (process.env.NODE_ENV !== 'production') {
    const port = String(process.env.PORT || '3000').trim() || '3000'
    return `http://127.0.0.1:${port}`
  }

  const host = String(req.headers.host || '').trim()
  if (!host) throw new Error('Missing host')
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim()
  const proto = forwardedProto || 'https'
  return `${proto}://${host}`
}

async function runShellCommand(command: string): Promise<{ command: string; ok: boolean; code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('close', (code) => {
      resolve({
        command,
        ok: code === 0,
        code,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      })
    })

    child.on('error', (err) => {
      resolve({
        command,
        ok: false,
        code: null,
        stdout: stdout.slice(-4000),
        stderr: `${stderr}\n${String(err)}`.trim().slice(-4000),
      })
    })
  })
}

async function runPipeline(
  pipeline: SyncPipelineKey,
  onProgress?: (p: { stage: string; progress: number; detail?: string }) => Promise<void>
) {
  const commands = ALLOWLISTED_PIPELINES[pipeline] || []
  const results: Array<{ command: string; ok: boolean; code: number | null; stdout: string; stderr: string }> = []

  for (let idx = 0; idx < commands.length; idx += 1) {
    const command = commands[idx]
    const step = idx + 1
    if (onProgress) {
      await onProgress({
        stage: `스크립트 실행 ${step}/${commands.length}`,
        progress: 10 + Math.round((step / Math.max(1, commands.length)) * 30),
        detail: command,
      })
    }
    const result = await runShellCommand(command)
    results.push(result)
    if (!result.ok) break
  }

  return {
    pipeline,
    ok: results.every((r) => r.ok),
    results,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = resolveCorsOrigin(req)
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const body = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body) } catch { return {} } })()
      : (req.body || {})

    const syncId = String((body as any)?.syncId || '').trim()
    const runScripts = toBool((body as any)?.runScripts)
    const requestedPipeline = String((body as any)?.pipeline || 'dbview-default') as SyncPipelineKey

    if (syncId) {
      await startSyncJob({
        id: syncId,
        kind: runScripts ? requestedPipeline : 'stocks-refresh',
        stage: '요청 접수',
        progress: 3,
        detail: '동기화 요청을 접수했습니다.',
      })
    }

    const allowScriptRunner = toBool(process.env.ENABLE_WEB_SCRIPT_RUNNER)
    const allowIntradayRunner = requestedPipeline === 'intraday-refresh'

    let scriptRun: { pipeline: SyncPipelineKey; ok: boolean; results: Array<{ command: string; ok: boolean; code: number | null; stdout: string; stderr: string }> } | null = null
    let scriptError: string | null = null
    const runScriptAfterCoreUpdate = requestedPipeline === 'intraday-refresh'

    if (runScripts && (allowScriptRunner || allowIntradayRunner) && requestedPipeline in ALLOWLISTED_PIPELINES && !runScriptAfterCoreUpdate) {
      if (syncId) {
        await updateSyncJob({
          id: syncId,
          stage: '스크립트 파이프라인 실행',
          progress: 8,
          detail: requestedPipeline,
        })
      }
      scriptRun = await runPipeline(requestedPipeline, async (p) => {
        if (!syncId) return
        await updateSyncJob({
          id: syncId,
          stage: p.stage,
          progress: p.progress,
          detail: p.detail,
        })
      })
      if (!scriptRun.ok) {
        // 스크립트 실패가 있어도 core update API는 계속 실행해 데이터 동기화를 시도합니다.
        scriptError = 'Script pipeline failed'
        if (syncId) {
          await updateSyncJob({
            id: syncId,
            stage: '스크립트 실패, DB 업데이트 계속',
            progress: 45,
            detail: scriptRun.results[scriptRun.results.length - 1]?.stderr || scriptError,
          })
        }
      }
    }

    if (syncId) {
      await updateSyncJob({
        id: syncId,
        stage: 'DB 업데이트 호출',
        progress: 65,
        detail: 'update/index 호출 중',
      })
    }

    const base = resolveInternalBase(req)

    const secret = process.env.CRON_SECRET || process.env.TELEGRAM_BOT_SECRET || ''
    if (!secret) {
      const message = 'Server misconfigured: missing CRON_SECRET or TELEGRAM_BOT_SECRET'
      if (syncId) {
        await finishSyncJob({
          id: syncId,
          status: 'failed',
          stage: '서버 설정 오류',
          progress: 95,
          detail: message,
        })
      }
      return res.status(500).json({ error: message })
    }

    const updateHeaders = {
      'x-telegram-bot-secret': secret,
      'x-ui-key': String(readKey),
    }
    // add a timeout to avoid hanging in dev when target isn't reachable
    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), 120000)
    try {
      // update/index.ts 는 vercel dev에서 static file로 서빙될 수 있어서
      // stocks / sectors 를 직접 병렬 호출합니다.
      const [stocksRes, sectorsRes] = await Promise.all([
        fetch(`${base}/api/update/stocks`, { method: 'POST', headers: updateHeaders, signal: controller.signal }),
        fetch(`${base}/api/update/sectors`, { method: 'POST', headers: updateHeaders, signal: controller.signal }),
      ])
      clearTimeout(to)
      const stocksJson = await stocksRes.json().catch(() => ({ error: 'invalid json (stocks)' }))
      const sectorsJson = await sectorsRes.json().catch(() => ({ error: 'invalid json (sectors)' }))
      const updateOk = stocksRes.ok && sectorsRes.ok && !(stocksJson as any)?.error && !(sectorsJson as any)?.error
      const json = { ok: updateOk, stocks: { status: stocksRes.status, ...(stocksJson as object) }, sectors: { status: sectorsRes.status, ...(sectorsJson as object) } }
      if (runScripts && (allowScriptRunner || allowIntradayRunner) && requestedPipeline in ALLOWLISTED_PIPELINES && runScriptAfterCoreUpdate) {
        if (syncId) {
          await updateSyncJob({
            id: syncId,
            stage: '장중 신호 재계산 실행',
            progress: 78,
            detail: requestedPipeline,
          })
        }
        scriptRun = await runPipeline(requestedPipeline, async (p) => {
          if (!syncId) return
          await updateSyncJob({
            id: syncId,
            stage: p.stage,
            progress: 78 + Math.round(p.progress * 0.2),
            detail: p.detail,
          })
        })
        if (!scriptRun.ok) {
          scriptError = 'Script pipeline failed'
          if (syncId) {
            await updateSyncJob({
              id: syncId,
              stage: '장중 신호 재계산 실패',
              progress: 88,
              detail: scriptRun.results[scriptRun.results.length - 1]?.stderr || scriptError,
            })
          }
        }
      }
      // 핵심 DB 업데이트 성공 시 요청 자체는 성공으로 처리하고,
      // 스크립트 파이프라인 실패는 warning으로 전달한다.
      const responseOk = updateOk
      if (syncId) {
        await finishSyncJob({
          id: syncId,
          status: responseOk ? 'success' : 'failed',
          stage: responseOk
            ? (scriptError ? '동기화 완료 (스크립트 경고)' : '동기화 완료')
            : '동기화 실패',
          progress: responseOk ? 100 : 95,
          detail: responseOk
            ? (scriptError
              ? 'DB 업데이트는 완료되었고, 일부 스크립트 단계에서 경고가 발생했습니다.'
              : 'DB 업데이트와 후처리가 완료되었습니다.')
            : String((stocksJson as any)?.error || (sectorsJson as any)?.error || scriptError || '업데이트 실패'),
        })
      }
      return res.status(responseOk ? 200 : 500).json({
        ok: responseOk,
        body: json,
        ...(scriptError ? { warning: scriptError } : {}),
        scriptRunner: {
          enabled: allowScriptRunner || allowIntradayRunner,
          requested: runScripts,
          pipeline: requestedPipeline,
          result: scriptRun,
        },
      })
    } catch (err:any) {
      clearTimeout(to)
      if (syncId) {
        await finishSyncJob({
          id: syncId,
          status: 'failed',
          stage: err?.name === 'AbortError' ? '동기화 타임아웃' : '동기화 오류',
          progress: 95,
          detail: String(err?.message || err),
        })
      }
      if (err?.name === 'AbortError') return res.status(504).json({ error: 'Request to update timed out' })
      return res.status(500).json({ error: String(err) })
    }
  } catch (e:any) {
    const body = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body) } catch { return {} } })()
      : (req.body || {})
    const syncId = String((body as any)?.syncId || '').trim()
    if (syncId) {
      await finishSyncJob({
        id: syncId,
        status: 'failed',
        stage: '요청 처리 오류',
        progress: 90,
        detail: String(e),
      })
    }
    return res.status(500).json({ error: String(e) })
  }
}
