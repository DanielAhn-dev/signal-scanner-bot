import type { VercelRequest, VercelResponse } from '@vercel/node'
import { searchByNameOrCode } from '../../src/search/normalize'

type Hit = { code: string; name: string }

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

  return [...new Set(filtered)].slice(0, 12)
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
    const tokens = extractTokens(decodedTitle)

    // 제목 자체로 우선 탐색 (별칭/초성/영문 지원)
    if (decodedTitle) {
      const titleHits = await searchByNameOrCode(decodedTitle, 8)
      const filtered = titleHits.filter((h) => {
        const nName = normalizeText(h.name)
        return nName.length >= 2 && nTitle.includes(nName)
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
        if (nTitle.includes(nName)) return true
        return normalizeText(token) === nName
      })

      addUnique(out, seen, filtered)
      if (out.length >= 12) break
    }

    return res.status(200).json(out.slice(0, 12))
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
