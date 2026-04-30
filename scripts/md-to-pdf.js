const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  // fall back to puppeteer-core if puppeteer not installed
  puppeteer = require('puppeteer-core');
}

function findChromeExecutable() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.CHROME;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    // Common Chrome paths on Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Edge (Chromium) as fallback
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

async function mdToPdf(mdPath, pdfPath) {
  const md = new MarkdownIt({html: true});
  const mdText = fs.readFileSync(mdPath, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', 'Arial', sans-serif; padding:24px; line-height:1.6; color:#111} h1,h2,h3{color:#111} pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}</style></head><body>${md.render(mdText)}</body></html>`;

  const launchOpts = {args: ['--no-sandbox', '--disable-setuid-sandbox']};
  const exe = findChromeExecutable();
  if (exe) launchOpts.executablePath = exe;

  try {
    const browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent(html, {waitUntil: 'networkidle0'});
    await page.pdf({path: pdfPath, format: 'A4', printBackground: true});
    await browser.close();
    return;
  } catch (err) {
    if (!exe) {
      console.error('Chrome/Chromium 실행 파일을 찾을 수 없습니다.');
      console.error('옵션: 1) 시스템에 Chrome/Edge 설치 2) Puppeteer의 크롬 다운로드 설치: `npx puppeteer install`');
      console.error('또는 환경변수 PUPPETEER_EXECUTABLE_PATH에 브라우저 경로를 설정하세요.');
    }
    throw err;
  }
}

const [,, mdPath, pdfPath] = process.argv;
if (!mdPath || !pdfPath) {
  console.error('Usage: node scripts/md-to-pdf.js input.md output.pdf');
  process.exit(2);
}

mdToPdf(mdPath, pdfPath).catch(err => {
  console.error(err);
  process.exit(1);
});
