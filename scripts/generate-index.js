import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS_DIR = resolve('docs');
const OUTPUT = resolve('docs/index.html');

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function main() {
  const files = readdirSync(DOCS_DIR)
    .filter(f => f.startsWith('parkinson-') && f.endsWith('.html') && f !== 'index.html')
    .sort()
    .reverse();

  const maxShow = 30;
  const shown = files.slice(0, maxShow);

  const rows = shown.map(f => {
    const dateMatch = f.match(/parkinson-(\d{4}-\d{2}-\d{2})\.html/);
    if (!dateMatch) return '';
    const dateStr = dateMatch[1];
    const d = new Date(dateStr);
    const display = d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Taipei' });
    const dayOfWeek = d.toLocaleDateString('zh-TW', { weekday: 'long', timeZone: 'Asia/Taipei' });

    let paperCount = 0;
    try {
      const content = readFileSync(resolve(DOCS_DIR, f), 'utf-8');
      const countMatch = content.match(/所有文獻/);
      if (countMatch) paperCount = 1;
    } catch {}

    return `
      <a href="${f}" class="report-card">
        <div class="card-date">
          <span class="day">${parseInt(dateStr.split('-')[2])}</span>
          <span class="month">${d.toLocaleDateString('zh-TW', { month: 'short', timeZone: 'Asia/Taipei' })}</span>
        </div>
        <div class="card-info">
          <div class="card-title">${display} ${dayOfWeek}</div>
          <div class="card-sub">巴金森病每日研究摘要</div>
        </div>
        <span class="arrow">&#8594;</span>
      </a>`;
  }).filter(Boolean).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>巴金森病每日研究摘要 | Parkinson's Disease Daily Digest</title>
<meta name="description" content="巴金森病（Parkinson's Disease）每日研究文獻自動摘要，由 AI 分析生成">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf}
*{margin:0;padding:0;box-sizing:border-box}
body{background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);font-family:"Noto Sans TC","PingFang TC","Helvetica Neue",Arial,sans-serif;color:var(--text);line-height:1.7;min-height:100vh}
.container{max-width:640px;margin:0 auto;padding:24px 20px 60px}
.header{text-align:center;padding:48px 0 36px;animation:fadeDown 0.6s ease-out}
.header h1{font-size:26px;font-weight:700;color:var(--text);margin-bottom:8px}
.header .sub{font-size:15px;color:var(--muted)}
.header .badge{display:inline-block;background:var(--accent);color:#fff;padding:4px 14px;border-radius:999px;font-size:12px;font-weight:600;margin-top:12px}
.report-card{display:flex;align-items:center;gap:16px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:12px;text-decoration:none;color:var(--text);transition:transform 0.15s,box-shadow 0.15s;animation:fadeUp 0.5s ease-out;animation-fill-mode:both}
.report-card:nth-child(2){animation-delay:0.05s}
.report-card:nth-child(3){animation-delay:0.1s}
.report-card:nth-child(4){animation-delay:0.15s}
.report-card:nth-child(5){animation-delay:0.2s}
.report-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.08)}
.card-date{display:flex;flex-direction:column;align-items:center;background:rgba(140,79,43,0.08);border-radius:10px;padding:8px 14px;min-width:56px}
.card-date .day{font-size:22px;font-weight:700;color:var(--accent);line-height:1.1}
.card-date .month{font-size:11px;color:var(--muted);margin-top:2px}
.card-info{flex:1;min-width:0}
.card-title{font-size:15px;font-weight:600;color:var(--text)}
.card-sub{font-size:13px;color:var(--muted);margin-top:2px}
.arrow{font-size:18px;color:var(--line);transition:transform 0.15s}
.report-card:hover .arrow{transform:translateX(4px);color:var(--accent)}
.footer{text-align:center;padding:30px 0 10px;border-top:1px solid var(--line);margin-top:30px}
.footer p{font-size:13px;color:var(--muted);margin-bottom:12px}
.footer a{display:inline-block;margin:4px 8px;padding:8px 16px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:500;transition:transform 0.15s}
.footer a:hover{transform:translateY(-2px)}
.footer .clinic{background:var(--accent);color:#fff}
.footer .newsletter{background:var(--accent-soft);color:var(--accent)}
.footer .coffee{background:#ffdd00;color:#2b2118}
@keyframes fadeDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){
  .container{padding:16px 12px 40px}
  .header h1{font-size:21px}
  .report-card{padding:14px 16px}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🧠 巴金森病每日研究摘要</h1>
    <div class="sub">Parkinson's Disease Daily Research Digest</div>
    <div class="badge">共 ${files.length} 期 · 自動更新</div>
  </div>

  ${rows}

  ${files.length > maxShow ? `<p style="text-align:center;color:var(--muted);font-size:14px;margin-top:20px">僅顯示最近 ${maxShow} 期，共 ${files.length} 期報告</p>` : ''}

  <div class="footer">
    <p>由 AI 自動分析 PubMed 最新文獻生成</p>
    <a href="https://www.leepsyclinic.com/" target="_blank" rel="noopener" class="clinic">🏥 李政洋身心診所</a>
    <a href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener" class="newsletter">📩 訂閱電子報</a>
    <a href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener" class="coffee">☕ Buy Me a Coffee</a>
  </div>
</div>
</body>
</html>`;

  writeFileSync(OUTPUT, html, 'utf-8');
  console.log(`Index page generated: ${OUTPUT} (${files.length} reports)`);
}

main();
