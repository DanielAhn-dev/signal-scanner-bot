#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'generated');
const OUT_JSON = path.join(OUT_DIR, 'system-analysis.json');
const OUT_MD = path.join(OUT_DIR, 'system-analysis.md');

const SCAN_PATHS = [
  'src',
  'scripts',
  'api',
  'data',
  'db'
];

const KEYWORDS = [
  'risk', 'stop', 'stoploss', 'position', 'sizing', 'backtest', 'virtual', 'autotrade', 'telegram', 'strategy', 'edge'
];

async function walk(dir, fileList = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'docs/generated'].includes(e.name)) continue;
      await walk(full, fileList);
    } else {
      fileList.push(full);
    }
  }
  return fileList;
}

async function inspectFile(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const stat = await fsp.stat(file);
  const ext = path.extname(file).toLowerCase();
  const info = { path: rel, size: stat.size, mtime: stat.mtime.toISOString(), ext };
  try {
    if (stat.size < 2000000 && /\.(js|ts|mjs|py|md|json|tsx|jsx)$/.test(ext)) {
      const txt = await fsp.readFile(file, 'utf8');
      const found = [];
      for (const k of KEYWORDS) if (txt.toLowerCase().includes(k)) found.push(k);
      info.keywords = [...new Set(found)];
      info.lines = txt.split(/\r?\n/).length;
    }
  } catch (err) {
    info.error = String(err);
  }
  return info;
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), scans: {} };
  for (const p of SCAN_PATHS) {
    const abs = path.join(ROOT, p);
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isDirectory()) {
        report.scans[p] = { exists: false };
        continue;
      }
    } catch (e) {
      report.scans[p] = { exists: false };
      continue;
    }
    const files = await walk(abs);
    const items = [];
    for (const f of files) {
      try {
        const info = await inspectFile(f);
        items.push(info);
      } catch (err) {
        items.push({ path: path.relative(ROOT, f), error: String(err) });
      }
    }
    report.scans[p] = { exists: true, count: items.length, files: items };
  }

  // Summary: find files with risk-related keywords and large files
  const summary = { keywordMatches: [], largeFiles: [] };
  for (const [k, v] of Object.entries(report.scans)) {
    if (!v.exists) continue;
    for (const f of v.files) {
      if (f.keywords && f.keywords.length) summary.keywordMatches.push({ path: f.path, keywords: f.keywords });
      if (f.size && f.size > 200000) summary.largeFiles.push({ path: f.path, size: f.size });
    }
  }

  report.summary = summary;
  await fsp.writeFile(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  // Write a simple markdown report
  const md = [];
  md.push('# System Analysis Report');
  md.push('Generated: ' + report.generatedAt);
  md.push('\n## Summary');
  md.push(`- Scanned paths: ${SCAN_PATHS.join(', ')}`);
  md.push(`- Keyword matches: ${summary.keywordMatches.length}`);
  md.push(`- Large files (>200KB): ${summary.largeFiles.length}`);
  md.push('\n## Keyword Matches (top 50)');
  summary.keywordMatches.slice(0,50).forEach(m => md.push(`- ${m.path}: ${m.keywords.join(', ')}`));
  md.push('\n## Large Files (top 50)');
  summary.largeFiles.slice(0,50).forEach(m => md.push(`- ${m.path}: ${Math.round(m.size/1024)} KB`));
  md.push('\n---\n');
  md.push('Full JSON report: `docs/generated/system-analysis.json`');

  await fsp.writeFile(OUT_MD, md.join('\n'), 'utf8');

  console.log('Analysis complete. JSON:', OUT_JSON, 'MD:', OUT_MD);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(2);
});
