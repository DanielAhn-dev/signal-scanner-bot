import type { ReportTopic } from './reportSnapshotService'

export function topicLabel(topic: ReportTopic | string): string {
  if (topic === '주간') return '주간'
  if (topic === '눌림목') return '눌림목'
  if (topic === '포트폴리오') return '포트폴리오'
  if (topic === '관심종목') return '관심종목'
  if (topic === '거시') return '거시'
  if (topic === '수급') return '수급'
  if (topic === '섹터') return '섹터'
  if (topic === '확신추천') return '확신추천'
  if (topic === '공개추천') return '공개추천'
  if (topic === '가이드') return '운영 가이드'
  if (topic === '자동매매') return '자동매매 가이드'
  return '추천'
}

export function topicTitle(topic: ReportTopic | string): string {
  if (topic === '주간') return '주간 증시 리포트'
  if (topic === '눌림목') return '다음 주 눌림목 리포트'
  if (topic === '포트폴리오') return '보유 포트폴리오 리포트'
  if (topic === '관심종목') return '관심종목 리포트'
  if (topic === '거시') return '거시 지표 리포트'
  if (topic === '수급') return '수급 리포트'
  if (topic === '섹터') return '섹터 리포트'
  if (topic === '확신추천') return '확신추천 하이라이트 3선'
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

      /* Primitive token values */
      --color-blue-50: #EBF3FF;
      --color-blue-500: #0060FF;
      --color-gray-0: #FFFFFF;
      --color-gray-50: #F9FAFB;
      --color-gray-100: #F2F4F6;
      --color-gray-200: #E5E8EB;
      --color-gray-500: #8B95A1;
      --color-gray-600: #6B7280;
      --color-gray-900: #191F28;
      --color-gray-950: #0D1117;

      /* Semantic token aliases */
      --color-brand: var(--color-blue-500);
      --color-brand-subtle: var(--color-blue-50);
      --color-bg-page: var(--color-gray-100);
      --color-bg-surface: var(--color-gray-0);
      --color-border-default: var(--color-gray-200);
      --color-text-primary: var(--color-gray-900);
      --color-text-secondary: var(--color-gray-600);
      --color-text-tertiary: var(--color-gray-500);

      /* Stock up/down — 한국 증권: 상승=빨강, 하락=파랑 */
      --color-stock-up:      #F04452;
      --color-stock-down:    #1478FF;
      --color-stock-flat:    var(--color-gray-500);

      /* Additional surface */
      --color-bg-sunken: var(--color-gray-50);

      --font-family-sans: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      --font-family-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --font-weight-medium: 500;
      --font-weight-semibold: 600;
      --font-weight-bold: 700;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);

      --code-bg: var(--color-gray-950);
      --code-text: #E2E8F0;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; background:
      radial-gradient(circle at top right, rgba(0,96,255,0.14), transparent 28%),
      linear-gradient(180deg, #f8fafc 0%, var(--color-bg-page) 100%); color: var(--color-text-primary); }
    body {
      font-family: var(--font-family-sans);
      line-height: 1.6;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px 14px;
    }
    .shell {
      width: min(980px, 100%);
      margin: 0 auto;
      background: color-mix(in srgb, var(--color-bg-surface) 92%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-border-default) 92%, transparent);
      backdrop-filter: blur(14px);
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    .hero {
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--color-border-default);
      background: linear-gradient(120deg, var(--color-brand-subtle), rgba(255,255,255,0.96) 55%);
    }
    .badge {
      display: block;
      color: var(--color-text-tertiary);
      padding: 0;
      font-size: 12px;
      font-weight: var(--font-weight-medium);
      letter-spacing: 0;
    }
    h1 { margin: 10px 0 6px; font-size: clamp(22px, 3.4vw, 30px); line-height: 1.25; letter-spacing: -0.02em; }
    .meta { color: var(--color-text-secondary); font-size: 13px; }
    .content { padding: 18px; font-size: 15px; }
    .content p { margin: 0.68em 0; line-height: 1.7; }
    .content h2 {
      margin: 1.15em 0 0.45em;
      font-size: 1.05rem;
      font-weight: var(--font-weight-bold);
      line-height: 1.35;
      letter-spacing: -0.01em;
      color: var(--color-text-primary);
      padding-bottom: 0.22em;
      border-bottom: 1px solid var(--color-border-default);
    }
    .content hr { border: 0; border-top: 1px solid var(--color-border-default); margin: 0.75em 0; }
    .content ul, .content ol { margin: 0.55em 0 0.85em; padding-left: 1.32em; }
    .content li + li { margin-top: 0.22em; }
    .content code {
      font-family: var(--font-family-mono);
      font-size: 0.9em;
      background: color-mix(in srgb, var(--color-brand-subtle) 65%, #ffffff);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      padding: 0.08em 0.34em;
    }
    .content pre {
      margin: 0; padding: 14px; overflow: auto; border-radius: var(--radius-md); background: var(--code-bg); color: var(--code-text);
      font-family: var(--font-family-mono); font-size: 13px; line-height: 1.52; white-space: pre-wrap; word-break: break-word;
    }
    .footer {
      padding: 14px 18px 20px;
      border-top: 1px solid var(--color-border-default);
      color: var(--color-text-secondary);
      font-size: 12px;
      background: color-mix(in srgb, var(--color-gray-50) 80%, transparent);
    }
    @media (max-width: 720px) {
      body { padding: 10px 8px; }
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
    <footer class="footer">공유 링크는 만료되거나 철회될 수 있습니다.</footer>
  </main>
</body>
</html>`
}
