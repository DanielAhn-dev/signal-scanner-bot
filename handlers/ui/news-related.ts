import type { VercelRequest, VercelResponse } from '@vercel/node'
import { searchByNameOrCode } from '../../src/search/normalize'
import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import fs from 'node:fs/promises'
import path from 'node:path'

type Hit = { code: string; name: string }
type KrxRow = { code: string; name: string }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
let _krxUniverse: KrxRow[] | null = null

// 가격 기반 별명 패턴: "25만전자" → 삼성전자, "160만닉스" → SK하이닉스 등
const NICKNAME_PATTERNS: Array<{ pattern: RegExp; code: string; name: string }> = [
  { pattern: /\d+만\s*전자/, code: '005930', name: '삼성전자' },
  { pattern: /\d+만\s*닉스/, code: '000660', name: 'SK하이닉스' },
  { pattern: /\d+만\s*카카오/, code: '035720', name: '카카오' },
  { pattern: /\d+만\s*네이버/, code: '035420', name: 'NAVER' },
  { pattern: /\d+만\s*셀트리온/, code: '068270', name: '셀트리온' },
  { pattern: /\d+만\s*현대차/, code: '005380', name: '현대차' },
  { pattern: /\d+만\s*기아/, code: '000270', name: '기아' },
  { pattern: /\d+만\s*포스코/, code: '005490', name: 'POSCO홀딩스' },
  { pattern: /\d+만\s*LG전자/, code: '066570', name: 'LG전자' },
  { pattern: /\d+만\s*배터리/, code: '373220', name: 'LG에너지솔루션' },
  { pattern: /\d+만\s*엔솔/, code: '373220', name: 'LG에너지솔루션' },
  { pattern: /\d+만\s*삼바/, code: '207940', name: '삼성바이오로직스' },
  { pattern: /\d+만\s*카뱅/, code: '323410', name: '카카오뱅크' },
  { pattern: /\d+만\s*크래프톤/, code: '259960', name: '크래프톤' },
]

// 허용 도메인: naver + 주요 국내 경제지
const ALLOWED_HOSTS = new Set([
  'n.news.naver.com',
  'finance.naver.com',
  'news.naver.com',
  'www.sedaily.com',
  'sedaily.com',
  'www.hankyung.com',
  'hankyung.com',
  'www.mk.co.kr',
  'mk.co.kr',
  'www.etnews.com',
  'etnews.com',
  'www.edaily.co.kr',
  'edaily.co.kr',
  'www.inews24.com',
  'inews24.com',
  'biz.chosun.com',
  'www.chosun.com',
  'www.yna.co.kr',
  'yna.co.kr',
])

// 사이트별 본문 셀렉터 (naver 외 경제지)
const SITE_SELECTORS: Record<string, string[]> = {
  'hankyung.com': ['#articletxt', '.article-body', '.article_body'],
  'mk.co.kr': ['#articleBody', '.art_txt', '.art_cont'],
  'sedaily.com': ['#v-left-relative > div.article_view', '.article_view', '#article_area'],
  'etnews.com': ['#articleBody', '.article_body'],
  'edaily.co.kr': ['#articleBody', '.article_body'],
  'inews24.com': ['#article-view-content-div', '.article_txt'],
  'chosun.com': ['#article-content', '.article-body__content'],
  'yna.co.kr': ['.story-news article', '#articleWrap'],
}

function resolveNicknames(title: string): Hit[] {
  const hits: Hit[] = []
  for (const { pattern, code, name } of NICKNAME_PATTERNS) {
    if (pattern.test(title)) hits.push({ code, name })
  }
  return hits
}

const STOP = new Set([
  '이번', '지난', '오늘', '내일', '관련', '주요', '대형', '소형', '중형',
  '최근', '이후', '이전', '국내', '국외', '국제', '세계', '글로벌', '업계',
  '시장', '정부', '기업', '회사', '업체', '주가', '주식', '상장', '하락',
  '상승', '급락', '급등', '코스피', '코스닥', '한국', '미국', '중국', '일본',
  '영국', '독일', '프랑스', '러시아', '인도', '브라질', '호주', '캐나다',
  '단독', '클릭', '속보', '전망', '우려', '호재', '악재',
])

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/gi, ' ')
    .replace(/&#34;/g, ' ')
    .replace(/&apos;/gi, ' ')
    .replace(/&#39;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[()\[\]{}'"“”‘’·.,:;!?\-_/|]/g, '')
}

function extractTokens(title: string): string[] {
  const plain = decodeHtmlEntities(title)
  const matches = plain.match(/[A-Za-z&]{2,}|[가-힣0-9]{2,}/g) || []
  const filtered = matches
    .map((v) => v.trim())
    .filter((v) => v.length >= 2 && !STOP.has(v))

  return [...new Set(filtered)].slice(0, 24)
}

function maybeDecodeHtml(ab: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(ab)
  if (!utf8.includes('�')) return utf8
  try {
    return iconv.decode(Buffer.from(ab), 'euc-kr')
  } catch {
    return utf8
  }
}

function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchArticleText(link: string): Promise<string> {
  try {
    const url = new URL(link)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const fullHost = url.hostname.toLowerCase()
    if (!ALLOWED_HOSTS.has(host) && !ALLOWED_HOSTS.has(fullHost)) return ''

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5',
        Referer: `${url.protocol}//${url.hostname}/`,
      },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return ''

    const ab = await res.arrayBuffer()
    const html = maybeDecodeHtml(ab)
    const $ = cheerio.load(html)

    // naver 전용 셀렉터
    const naverSelectors = [
      '#dic_area',
      '#newsct_article',
      '#articleBodyContents',
      '#articeBody',
      '.newsct_article',
      '.article_body',
    ]

    // 사이트별 셀렉터 우선 시도
    const siteSelectors = SITE_SELECTORS[host] || SITE_SELECTORS[fullHost.replace(/^www\./, '')] || []
    const allSelectors = [...siteSelectors, ...naverSelectors]

    for (const sel of allSelectors) {
      const t = sanitizeText($(sel).text())
      if (t.length >= 40) return t.slice(0, 3000)
    }

    // 폴백: body 전체 (최대 3000자)
    return sanitizeText($('body').text()).slice(0, 3000)
  } catch {
    return ''
  }
}

async function loadKrxUniverse(): Promise<KrxRow[]> {
  if (_krxUniverse) return _krxUniverse
  try {
    const fp = path.resolve(process.cwd(), 'data', 'all_krx.json')
    const raw = await fs.readFile(fp, 'utf-8')
    const arr = JSON.parse(raw)
    _krxUniverse = Array.isArray(arr)
      ? arr
        .map((r: any) => ({ code: String(r?.code || '').trim(), name: String(r?.name || '').trim() }))
        .filter((r: KrxRow) => r.code && r.name)
      : []
  } catch {
    _krxUniverse = []
  }
  return _krxUniverse
}

// 공백·구두점 기준 토큰 분리 후 종목명이 독립 토큰으로 시작하는지 확인
// "릴레이" 안의 "레이" 같은 부분 문자열 과매칭 방지용
function matchesWordBoundary(rawCorpus: string, nn: string): boolean {
  const SEP = /[\s·,，。、\-\/|()[\]<>《》「」【】'"""'']+/
  return rawCorpus.split(SEP).some((tok) => {
    const nt = normalizeText(tok)
    return nt === nn || nt.startsWith(nn)
  })
}

async function findByLocalUniverse(corpus: string, limit = 12): Promise<Hit[]> {
  const nCorpus = normalizeText(corpus)
  if (!nCorpus) return []
  const universe = await loadKrxUniverse()
  if (!universe.length) return []

  const matched = universe
    .filter((r) => {
      const nn = normalizeText(r.name)
      if (nn.length < 2 || !nCorpus.includes(nn)) return false
      // 짧은 이름(≤3자)은 단어 경계 검사로 과매칭 방지 (예: 릴레이→레이)
      if (nn.length <= 3) return matchesWordBoundary(corpus, nn)
      return true
    })
    // 짧은 종목명이 과매칭되는 문제를 줄이기 위해 긴 이름 우선
    .sort((a, b) => b.name.length - a.name.length)
    .slice(0, limit)

  return matched.map((r) => ({ code: r.code, name: r.name }))
}

function addUnique(out: Hit[], seen: Set<string>, rows: Hit[]) {
  for (const r of rows) {
    const code = String(r.code || '').trim()
    const name = String(r.name || '').trim()
    if (!code || !name || seen.has(code)) continue
    seen.add(code)
    out.push({ code, name })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const title = String(req.query.title || '').trim()
  const link = String(req.query.link || '').trim()
  const baseCode = String(req.query.baseCode || '').trim()
  const baseName = String(req.query.baseName || '').trim()

  if (!title && !baseCode) return res.status(200).json([])

  try {
    const out: Hit[] = []
    const seen = new Set<string>()

    // 검색 종목이 있는 화면에서는 해당 종목을 항상 포함
    if (baseCode && baseName) {
      addUnique(out, seen, [{ code: baseCode, name: baseName }])
    }

    const decodedTitle = decodeHtmlEntities(title)
    const nTitle = normalizeText(decodedTitle)
    let articleText = ''

    // 가격 별명 우선 해석 (예: "25만전자" → 삼성전자)
    addUnique(out, seen, resolveNicknames(decodedTitle))

    // 제목이 모호한 기사(예: '이 회사')는 링크 본문에서 종목명을 추가 탐지
    if (link) {
      articleText = await fetchArticleText(link)
    }

    const searchCorpus = `${decodedTitle} ${articleText}`.trim()
    const nCorpus = normalizeText(searchCorpus)
    const tokens = extractTokens(searchCorpus)

    // 제목 자체로 우선 탐색 (별칭/초성/영문 지원)
    if (decodedTitle) {
      const titleHits = await searchByNameOrCode(decodedTitle, 8)
      const filtered = titleHits.filter((h) => {
        const nName = normalizeText(h.name)
        return nName.length >= 2 && (nTitle.includes(nName) || nCorpus.includes(nName))
      })
      addUnique(out, seen, filtered)
    }

    // 토큰 단위 탐색
    for (const token of tokens) {
      const hits = await searchByNameOrCode(token, 3)
      if (!hits.length) continue

      const filtered = hits.filter((h) => {
        const nName = normalizeText(h.name)
        if (nName.length < 2) return false
        const inTitle = nTitle.includes(nName)
        const inCorpus = nCorpus.includes(nName)
        if (!inTitle && !inCorpus) return normalizeText(token) === nName
        // 짧은 이름은 단어 경계 확인으로 과매칭 방지
        if (nName.length <= 3) return matchesWordBoundary(searchCorpus, nName)
        return true
      })

      addUnique(out, seen, filtered)
      if (out.length >= 12) break
    }

    // 대안: DB/별칭 탐색이 비거나 누락되면 로컬 KRX 유니버스로 본문 포함 매칭
    const localHits = await findByLocalUniverse(searchCorpus, 12)
    addUnique(out, seen, localHits)

    return res.status(200).json(out.slice(0, 12))
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
