import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import https from 'node:https';

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const INPUT = getArg('input') || 'papers.json';
const OUTPUT = getArg('output') || 'docs/parkinson-report.html';
const REPORT_DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);
const API_KEY = process.env.ZHIPU_API_KEY;
const API_BASE = 'https://open.bigmodel.cn/api/coding/paas/v4';
const MAX_TOKENS = 16384;
const TIMEOUT = 480000;
const MODELS = ['GLM-5-Turbo', 'GLM-4.7', 'GLM-4.7-Flash'];

function httpsPost(url, headers, body) {
  return new Promise((resolvePost, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolvePost(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

function safeParseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const patterns = [/```json\s*([\s\S]*?)```/, /```\s*([\s\S]*?)```/, /\{[\s\S]*\}/];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) { try { return JSON.parse(m[1] || m[0]); } catch {} }
  }
  throw new Error('JSON parse failed');
}

async function callAI(prompt, modelOverride) {
  const models = modelOverride ? [modelOverride, ...MODELS.filter(m => m !== modelOverride)] : MODELS;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Calling ${model} (attempt ${attempt})...`);
        const response = await httpsPost(
          `${API_BASE}/chat/completions`,
          { 'Authorization': `Bearer ${API_KEY}` },
          { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: MAX_TOKENS }
        );
        const json = JSON.parse(response);
        const content = json.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('Empty response');
        return safeParseJSON(content);
      } catch (e) {
        console.error(`${model} attempt ${attempt} failed: ${e.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
  throw new Error('All models failed');
}

function escapeHTML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildSummaryPrompt(papers) {
  const paperList = papers.map((p, i) =>
    `[${i + 1}] PMID:${p.pmid}\nTitle:${p.title}\nJournal:${p.journal}\nAbstract:${(p.abstract || 'N/A').slice(0, 800)}`
  ).join('\n\n');

  return `你是巴金森病研究分析專家。分析以下最新論文，用繁體中文生成每日摘要。

論文列表:
${paperList}

回傳JSON格式:
{
  "market_summary": "3-5段繁體中文總結，涵蓋主要發現與臨床意義",
  "keywords": ["10-15個關鍵詞"],
  "topic_distribution": {"Biomarkers":0,"Treatment":0,"Genetics":0,"Neuroimaging":0,"Non-motor Symptoms":0,"Rehabilitation":0,"Nutrition":0,"Psychiatry":0,"Epidemiology":0,"Basic Science":0,"Caregiver/Quality of Life":0}
}

只回傳JSON，不要markdown格式。`;
}

function buildDetailPrompt(papers) {
  const paperList = papers.map((p, i) =>
    `[${i + 1}] PMID:${p.pmid}\nTitle:${p.title}\nJournal:${p.journal}\nDate:${p.date}\nAbstract:${(p.abstract || 'N/A').slice(0, 600)}\nKeywords:${(p.keywords || []).join(',')}\nURL:${p.url}`
  ).join('\n\n');

  return `你是巴金森病研究分析專家。為以下論文生成詳細分析，用繁體中文。

論文:
${paperList}

回傳JSON:
{
  "top_picks": [
    {
      "pmid":"string","title":"string","journal":"string","date":"string","url":"string",
      "utility":"high|medium|low",
      "reason":"1-2句繁體中文說明",
      "category":"Biomarkers|Treatment|Genetics|Neuroimaging|Non-motor Symptoms|Rehabilitation|Nutrition|Psychiatry|Epidemiology|Basic Science|Caregiver/Quality of Life",
      "pico":{"population":"繁體中文","intervention":"繁體中文","comparison":"繁體中文","outcome":"繁體中文"}
    }
  ],
  "all_papers": [
    {
      "pmid":"string","title":"string","journal":"string","date":"string","url":"string",
      "category":"同上分類","summary":"1-2句繁體中文摘要","utility":"high|medium|low"
    }
  ]
}

規則:
- 選5-8篇最精選為top_picks
- 所有論文都要在all_papers
- 所有文字欄位用繁體中文
- 只回傳JSON`;
}

function generateHTML(data, reportDate, allPapersRaw) {
  const topPicks = data.top_picks || [];
  const allPapers = data.all_papers || allPapersRaw.map(p => ({
    pmid: p.pmid, title: p.title, journal: p.journal, date: p.date, url: p.url,
    category: 'General', summary: '', utility: 'medium'
  }));
  const keywords = data.keywords || [];
  const topicDist = data.topic_distribution || {};
  const summary = data.market_summary || '';

  const utilityColors = {
    high: { bg: 'rgba(90,122,58,0.1)', color: '#5a7a3a', label: '高實用性' },
    medium: { bg: 'rgba(159,122,46,0.1)', color: '#9f7a2e', label: '中實用性' },
    low: { bg: 'rgba(118,100,83,0.08)', color: '#766453', label: '參考用' },
  };

  const maxTopicCount = Math.max(...Object.values(topicDist), 1);
  const topicBars = Object.entries(topicDist).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([topic, count]) => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <span style="min-width:140px;text-align:right;font-size:14px;color:var(--text)">${escapeHTML(topic)}</span>
        <div style="flex:1;height:22px;background:var(--accent-soft);border-radius:11px;overflow:hidden">
          <div style="width:${(count / maxTopicCount) * 100}%;height:100%;background:linear-gradient(90deg,var(--accent),#c47a4a);border-radius:11px;transition:width 0.6s ease"></div>
        </div>
        <span style="min-width:30px;font-size:14px;color:var(--muted)">${count}</span>
      </div>`).join('');

  const topPicksHTML = topPicks.map(p => {
    const uc = utilityColors[p.utility] || utilityColors.medium;
    return `
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:20px;border-left:3px solid var(--accent);box-shadow:0 1px 4px rgba(0,0,0,0.04);transition:transform 0.2s,box-shadow 0.2s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.transform='';this.style.boxShadow='0 1px 4px rgba(0,0,0,0.04)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:17px;color:var(--text);line-height:1.5;flex:1;min-width:200px">
          <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">${escapeHTML(p.title)}</a>
        </h3>
        <span style="background:${uc.bg};color:${uc.color};padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap">${uc.label}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <span style="background:var(--accent-soft);color:var(--accent);padding:3px 10px;border-radius:999px;font-size:13px">${escapeHTML(p.journal)}</span>
        <span style="background:var(--accent-soft);color:var(--accent);padding:3px 10px;border-radius:999px;font-size:13px">${escapeHTML(p.category || '')}</span>
        <span style="color:var(--muted);font-size:13px;line-height:28px">${escapeHTML(p.date || '')}</span>
      </div>
      <p style="margin:0 0 16px;color:var(--text);font-size:14px;line-height:1.7">${escapeHTML(p.reason || '')}</p>
      ${p.pico ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${['population','intervention','comparison','outcome'].map(k => p.pico[k] ? `<div style="background:rgba(140,79,43,0.06);border-radius:10px;padding:10px 14px">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent)">${k[0].toUpperCase()}</span>
          <p style="margin:4px 0 0;font-size:13px;color:var(--text);line-height:1.5">${escapeHTML(p.pico[k])}</p>
        </div>` : '').join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  const allPapersHTML = allPapers.map(p => {
    const uc = utilityColors[p.utility] || utilityColors.medium;
    return `
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;gap:16px;align-items:flex-start;transition:transform 0.15s" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''">
      <span style="background:${uc.bg};color:${uc.color};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;margin-top:2px">${uc.label}</span>
      <div style="flex:1;min-width:0">
        <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;font-size:14px;font-weight:500;line-height:1.5;display:block">${escapeHTML(p.title)}</a>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <span style="font-size:12px;color:var(--muted)">${escapeHTML(p.journal)}</span>
          <span style="font-size:12px;color:var(--line)">|</span>
          <span style="font-size:12px;color:var(--muted)">${escapeHTML(p.date || '')}</span>
        </div>
        ${p.summary ? `<p style="margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.6">${escapeHTML(p.summary)}</p>` : ''}
      </div>
      <span style="background:var(--accent-soft);color:var(--accent);padding:3px 10px;border-radius:999px;font-size:12px;white-space:nowrap;margin-top:2px">${escapeHTML(p.category || '')}</span>
    </div>`;
  }).join('');

  const keywordHTML = keywords.map(k =>
    `<span style="background:var(--accent-soft);color:var(--accent);padding:4px 14px;border-radius:999px;font-size:13px;white-space:nowrap">${escapeHTML(k)}</span>`
  ).join('');

  const today = new Date(reportDate + 'T00:00:00+08:00');
  const dateStr = today.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Taipei' });

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>巴金森病每日研究摘要 | ${reportDate}</title>
<meta name="description" content="${reportDate} 巴金森病（Parkinson's Disease）每日研究文獻摘要，由 AI 自動分析生成">
<meta property="og:title" content="巴金森病每日研究摘要 | ${reportDate}">
<meta property="og:description" content="巴金森病研究每日自動摘要報告">
<meta property="og:type" content="article">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf;--card-bg:color-mix(in srgb,var(--surface) 92%,white)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);font-family:"Noto Sans TC","PingFang TC","Helvetica Neue",Arial,sans-serif;color:var(--text);line-height:1.7;min-height:100vh}
.container{max-width:880px;margin:0 auto;padding:24px 20px 60px}
a{color:var(--accent)}
@keyframes fadeDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.header{animation:fadeDown 0.6s ease-out;text-align:center;padding:40px 0 32px}
.header h1{font-size:28px;font-weight:700;color:var(--text);margin-bottom:8px}
.header .date{font-size:16px;color:var(--muted)}
.section{animation:fadeUp 0.6s ease-out;animation-fill-mode:both}
.section:nth-child(2){animation-delay:0.1s}
.section:nth-child(3){animation-delay:0.2s}
.section:nth-child(4){animation-delay:0.3s}
.section:nth-child(5){animation-delay:0.4s}
.section:nth-child(6){animation-delay:0.5s}
h2{font-size:20px;font-weight:700;color:var(--accent);margin:36px 0 16px;padding-bottom:8px;border-bottom:2px solid var(--line)}
.summary-box{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
.summary-box p{margin-bottom:14px;font-size:15px;color:var(--text);line-height:1.8}
.summary-box p:last-child{margin-bottom:0}
.footer{text-align:center;padding:40px 0 20px;border-top:1px solid var(--line);margin-top:40px}
.footer a{display:inline-block;margin:6px 10px;padding:8px 18px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500;transition:transform 0.15s,box-shadow 0.15s}
.footer a:hover{transform:translateY(-2px);box-shadow:0 3px 8px rgba(0,0,0,0.1)}
.footer .clinic{background:var(--accent);color:#fff}
.footer .newsletter{background:var(--accent-soft);color:var(--accent)}
.footer .coffee{background:#ffdd00;color:#2b2118}
.footer .back{background:var(--surface);color:var(--muted);border:1px solid var(--line)}
@media(max-width:600px){
  .container{padding:16px 12px 40px}
  .header h1{font-size:22px}
  h2{font-size:18px}
  .summary-box{padding:18px}
  div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr !important}
  div[style*="display:flex;gap:16px"]{flex-direction:column}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🧠 巴金森病每日研究摘要</h1>
    <div class="date">${dateStr} | Parkinson's Disease Daily Research Digest</div>
  </div>

  <div class="section">
    <h2>📊 今日總覽</h2>
    <div class="summary-box">
      ${summary.split('\n').filter(p => p.trim()).map(p => `<p>${escapeHTML(p)}</p>`).join('')}
    </div>
  </div>

  ${keywords.length > 0 ? `<div class="section"><h2>🏷️ 關鍵詞</h2><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">${keywordHTML}</div></div>` : ''}

  ${topicBars ? `<div class="section"><h2>📈 主題分布</h2>${topicBars}</div>` : ''}

  ${topPicksHTML ? `<div class="section"><h2>⭐ 精選文獻（Top Picks）</h2>${topPicksHTML}</div>` : ''}

  ${allPapersHTML ? `<div class="section"><h2>📋 所有文獻</h2>${allPapersHTML}</div>` : ''}

  <div class="footer">
    <a href="https://www.leepsyclinic.com/" target="_blank" rel="noopener" class="clinic">🏥 李政洋身心診所</a>
    <a href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener" class="newsletter">📩 訂閱電子報</a>
    <a href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener" class="coffee">☕ Buy Me a Coffee</a>
    <a href="index.html" class="back">📂 返回總覽</a>
  </div>
</div>
</body>
</html>`;
}

async function main() {
  if (!API_KEY) { console.error('ZHIPU_API_KEY is required'); process.exit(1); }

  const raw = readFileSync(INPUT, 'utf-8');
  const data = JSON.parse(raw);
  const papers = data.papers || [];
  if (papers.length === 0) { console.log('No papers'); process.exit(0); }

  console.log(`Analyzing ${papers.length} papers with AI...`);

  let summaryData = {};
  let detailData = {};

  try {
    console.log('Step 1: Generating summary...');
    summaryData = await callAI(buildSummaryPrompt(papers));
  } catch (e) {
    console.error('Summary generation failed:', e.message);
    summaryData = { market_summary: '今日摘要生成失敗，請稍後再試。', keywords: [], topic_distribution: {} };
  }

  const batchSize = 25;
  const batches = [];
  for (let i = 0; i < papers.length; i += batchSize) {
    batches.push(papers.slice(i, i + batchSize));
  }

  const allTopPicks = [];
  const allPaperDetails = [];

  for (let bi = 0; bi < batches.length; bi++) {
    try {
      console.log(`Step 2.${bi + 1}: Analyzing batch ${bi + 1}/${batches.length} (${batches[bi].length} papers)...`);
      const batchResult = await callAI(buildDetailPrompt(batches[bi]));
      if (batchResult.top_picks) allTopPicks.push(...batchResult.top_picks);
      if (batchResult.all_papers) allPaperDetails.push(...batchResult.all_papers);
    } catch (e) {
      console.error(`Batch ${bi + 1} analysis failed:`, e.message);
      for (const p of batches[bi]) {
        allPaperDetails.push({ pmid: p.pmid, title: p.title, journal: p.journal, date: p.date, url: p.url, category: 'General', summary: '', utility: 'medium' });
      }
    }
  }

  const mergedData = {
    market_summary: summaryData.market_summary || '',
    keywords: summaryData.keywords || [],
    topic_distribution: summaryData.topic_distribution || {},
    top_picks: allTopPicks,
    all_papers: allPaperDetails,
  };

  const html = generateHTML(mergedData, REPORT_DATE, papers);
  writeFileSync(OUTPUT, html, 'utf-8');
  console.log(`Report generated: ${OUTPUT}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
