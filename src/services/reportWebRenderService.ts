import type { ReportTopic } from './reportSnapshotService'

export function topicLabel(topic: ReportTopic | string): string {
  if (topic === '공개추천') return '공개추천'
  if (topic === '가이드') return '운영 가이드'
  if (topic === '자동매매') return '자동매매 가이드'
  return '추천'
}

export function topicTitle(topic: ReportTopic | string): string {
  if (topic === '공개추천') return '공유용 오늘의 투자 후보 리포트'
  if (topic === '가이드') return 'Signal Scanner Bot 운영 가이드'
  if (topic === '자동매매') return '자동매매 명령어 운영 가이드'
  return '오늘의 투자 후보 리포트'
}

export function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function restoreAllowedInlineTags(escaped: string): string {
  return escaped.replace(/&lt;(\/)?(b|strong|i|em|code|u|s)&gt;/gi, '<$1$2>')
}

function renderLine(line: string): string {
  return restoreAllowedInlineTags(escapeHtml(line))
}

export function toRichHtml(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return '<p>표시할 내용이 없습니다.</p>'

  const lines = normalized.split('\n').map((line) => line.trimEnd())
  const out: string[] = []
  let inParagraph = false
  let inUl = false
  let inOl = false

  const closeParagraph = () => {
    if (inParagraph) {
      out.push('</p>')
      inParagraph = false
    }
  }
  const closeLists = () => {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }
  const closeAll = () => {
    closeParagraph()
    closeLists()
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      closeAll()
      continue
    }
    if (/^[-─]{5,}$/.test(line)) {
      closeAll()
      out.push('<hr />')
      continue
    }

    const heading = line.match(/^<b>(.+)<\/b>$/i)
    if (heading) {
      closeAll()
      out.push(`<h2>${renderLine(heading[1])}</h2>`)
      continue
    }

    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      closeParagraph()
      if (!inOl) {
        if (inUl) {
          out.push('</ul>')
          inUl = false
        }
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${renderLine(ol[1])}</li>`)
      continue
    }

    const ul = line.match(/^•\s+(.+)$/)
    if (ul) {
      closeParagraph()
      if (!inUl) {
        if (inOl) {
          out.push('</ol>')
          inOl = false
        }
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${renderLine(ul[1])}</li>`)
      continue
    }

    closeLists()
    if (!inParagraph) {
      out.push('<p>')
      inParagraph = true
      out.push(renderLine(line))
    } else {
      out.push('<br />')
      out.push(renderLine(line))
    }
  }

  closeAll()
  return out.join('') || '<p>표시할 내용이 없습니다.</p>'
}

export function toPreHtml(text: string): string {
  return `<pre>${escapeHtml(text || '')}</pre>`
}

export function renderLayout(params: {
  title: string
  topic: ReportTopic | string
  sourceLabel: string
  contentHtml: string
  description?: string
  shareLocked?: boolean
}): string {
  const { title, topic, sourceLabel, contentHtml, description, shareLocked = false } = params
  const desc = description || `${topicLabel(topic)} 리포트를 웹에서 열람합니다.`
  const badge = shareLocked ? '공유 링크' : topicLabel(topic)

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <style>
    :root {
      color-scheme: light;
      --bg: #eef2f5;
      --surface: rgba(255,255,255,0.92);
      --border: #e5e8eb;
      --text: #191f28;
      --muted: #6b7280;
      --brand: #0060ff;
      --brand-soft: #ebf3ff;
      --code-bg: #0f172a;
      --code-text: #e2e8f0;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; background:
      radial-gradient(circle at top right, rgba(0,96,255,0.14), transparent 28%),
      linear-gradient(180deg, #f8fafc 0%, var(--bg) 100%); color: var(--text); }
    body {
      font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      padding: 24px 14px 40px;
    }
    .shell {
      width: min(980px, 100%);
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid rgba(229,232,235,0.9);
      backdrop-filter: blur(14px);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(15,23,42,0.08);
    }
    .hero {
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(120deg, var(--brand-soft), rgba(255,255,255,0.96) 55%);
    }
    .badge {
      display: inline-block;
      background: var(--brand);
      color: #fff;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    h1 { margin: 10px 0 6px; font-size: clamp(22px, 3.4vw, 30px); line-height: 1.25; }
    .meta { color: var(--muted); font-size: 13px; }
    .content { padding: 18px; font-size: 15px; }
    .content p { margin: 0.68em 0; line-height: 1.7; }
    .content h2 {
      margin: 1.15em 0 0.45em;
      font-size: 1.05rem;
      font-weight: 800;
      line-height: 1.35;
      letter-spacing: -0.01em;
      color: #0f172a;
      padding-bottom: 0.22em;
      border-bottom: 1px solid #e8edf3;
    }
    .content hr { border: 0; border-top: 1px solid var(--border); margin: 0.75em 0; }
    .content ul, .content ol { margin: 0.55em 0 0.85em; padding-left: 1.32em; }
    .content li + li { margin-top: 0.22em; }
    .content code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      font-size: 0.9em;
      background: #eef2ff;
      color: #334155;
      border-radius: 6px;
      padding: 0.08em 0.34em;
    }
    .content pre {
      margin: 0; padding: 14px; overflow: auto; border-radius: 10px; background: var(--code-bg); color: var(--code-text);
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace; font-size: 13px; line-height: 1.52; white-space: pre-wrap; word-break: break-word;
    }
    .footer {
      padding: 14px 18px 20px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      background: rgba(248,250,252,0.8);
    }
    @media (max-width: 720px) {
      body { padding: 10px 8px 18px; }
      .hero, .content, .footer { padding-left: 14px; padding-right: 14px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <span class="badge">${escapeHtml(badge)}</span>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">출처: ${escapeHtml(sourceLabel)} · 웹 렌더링 뷰</div>
    </header>
    <article class="content">${contentHtml}</article>
    <footer class="footer">Signal Scanner Bot · 공유 링크는 만료되거나 철회될 수 있습니다.</footer>
  </main>
</body>
</html>`
}
