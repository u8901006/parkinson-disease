import https from 'node:https';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const DAYS = parseInt(getArg('days') || '7', 10);
const MAX_PAPERS = parseInt(getArg('max-papers') || '50', 10);
const JSON_OUT = getArg('output') || 'papers.json';
const REPORT_DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);

const ALREADY_SUMMARIZED_DIR = resolve('docs');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const JOURNALS = [
  '"Movement Disorders"[ta]',
  '"Parkinsonism & related disorders"[ta]',
  '"Journal of Parkinson\'s disease"[ta]',
  '"NPJ Parkinsons Dis"[ta]',
  '"Journal of neural transmission"[ta]',
  '"Neurology"[ta]',
  '"JAMA neurology"[ta]',
  '"Lancet neurology"[ta]',
  '"Annals of neurology"[ta]',
  '"Brain"[ta]',
  '"Journal of neurology, neurosurgery, and psychiatry"[ta]',
  '"European journal of neurology"[ta]',
  '"Frontiers in neurology"[ta]',
  '"Journal of neurology"[ta]',
  '"BMC neurology"[ta]',
  '"Acta neurologica Scandinavica"[ta]',
  '"Nutrients"[ta]',
  '"Gut"[ta]',
  '"Microbiome"[ta]',
  '"Gut microbes"[ta]',
  '"American journal of geriatric psychiatry"[ta]',
  '"International journal of geriatric psychiatry"[ta]',
  '"Journal of affective disorders"[ta]',
  '"American journal of clinical nutrition"[ta]',
  '"Nutritional neuroscience"[ta]',
];

const TOPIC_QUERIES = [
  '("Parkinson Disease"[Mesh] OR "Parkinson disease"[tiab] OR "Parkinson\'s disease"[tiab] OR Parkinson*[tiab])',
];

async function searchPubMed(term, days) {
  const mindate = new Date(Date.now() - days * 86400000);
  const mindateStr = mindate.toISOString().slice(0, 10).replace(/-/g, '/');
  const maxdateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/');

  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&mindate=${mindateStr}&maxdate=${maxdateStr}&datetype=edat&retmax=${MAX_PAPERS}&sort=relevance&retmode=json&retstart=0`;

  const searchBody = await fetchUrl(searchUrl);
  const searchJson = JSON.parse(searchBody);
  const ids = searchJson.esearchresult?.idlist || [];
  return ids;
}

async function fetchDetails(pmids) {
  if (pmids.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < pmids.length; i += 50) {
    chunks.push(pmids.slice(i, i + 50));
  }

  const allPapers = [];
  for (const chunk of chunks) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${chunk.join(',')}&rettype=abstract&retmode=xml`;
    const xml = await fetchUrl(url);
    const papers = parseXML(xml);
    allPapers.push(...papers);
    if (chunks.length > 1) await sleep(400);
  }
  return allPapers;
}

function escXml(s) {
  return (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function parseXML(xml) {
  const papers = [];
  const articles = xml.split('<PubmedArticle>');
  for (let i = 1; i < articles.length; i++) {
    const block = articles[i];
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch ? pmidMatch[1] : '';

    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? escXml(titleMatch[1].replace(/<[^>]+>/g, '')) : '';

    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? escXml(journalMatch[1]) : '';

    const dateMatch = block.match(/<PubDate>([\s\S]*?)<\/PubDate>/);
    let pubDate = '';
    if (dateMatch) {
      const ym = dateMatch[1].match(/<Year>(\d+)<\/Year>[\s\S]*?<Month>(\d+)<\/Month>/);
      const ys = dateMatch[1].match(/<Year>(\d+)<\/Year>/);
      const medline = dateMatch[1].match(/<MedlineDate>(\d{4})\s/);
      if (ym) pubDate = `${ym[1]}-${ym[2].padStart(2, '0')}`;
      else if (ys) pubDate = ys[1];
      else if (medline) pubDate = medline[1];
    }

    let abstract = '';
    const absMatch = block.match(/<Abstract>([\s\S]*?)<\/Abstract>/);
    if (absMatch) {
      const texts = absMatch[1].match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g);
      if (texts) {
        abstract = texts.map(t => {
          const labelMatch = t.match(/Label="([^"]*)"/);
          const textMatch = t.match(/>([\s\S]*?)<\//);
          const label = labelMatch ? labelMatch[1] + ': ' : '';
          const text = textMatch ? escXml(textMatch[1].replace(/<[^>]+>/g, '')) : '';
          return label + text;
        }).join(' ').slice(0, 2000);
      }
    }

    const keywords = [];
    const kwMatches = block.matchAll(/<Keyword>([\s\S]*?)<\/Keyword>/g);
    for (const km of kwMatches) {
      keywords.push(escXml(km[1].trim()));
    }

    if (title && pmid) {
      papers.push({
        pmid,
        title,
        journal,
        date: pubDate,
        abstract,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        keywords: keywords.slice(0, 10),
      });
    }
  }
  return papers;
}

function getAlreadySummarizedPmids() {
  const pmids = new Set();
  try {
    const files = [];
    const dir = ALREADY_SUMMARIZED_DIR;
    const { readdirSync } = await import('node:fs');
    const entries = readdirSync(dir);
    for (const f of entries) {
      if (f.startsWith('parkinson-') && f.endsWith('.html')) {
        const dateMatch = f.match(/parkinson-(\d{4}-\d{2}-\d{2})\.html/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]);
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
          if (fileDate >= sevenDaysAgo) {
            try {
              const content = readFileSync(resolve(dir, f), 'utf-8');
              const pmidMatches = content.matchAll(/PMID:\s*(\d+)/g);
              for (const m of pmidMatches) pmids.add(m[1]);
              const hrefMatches = content.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g);
              for (const m of hrefMatches) pmids.add(m[1]);
            } catch {}
          }
        }
      }
    }
  } catch {}
  return pmids;
}

async function main() {
  console.log(`Fetching Parkinson's disease papers from last ${DAYS} days...`);

  let alreadyPmids;
  try {
    const { readdirSync } = await import('node:fs');
    alreadyPmids = new Set();
    const entries = readdirSync(ALREADY_SUMMARIZED_DIR);
    for (const f of entries) {
      if (f.startsWith('parkinson-') && f.endsWith('.html')) {
        const dateMatch = f.match(/parkinson-(\d{4}-\d{2}-\d{2})\.html/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]);
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
          if (fileDate >= sevenDaysAgo) {
            try {
              const content = readFileSync(resolve(ALREADY_SUMMARIZED_DIR, f), 'utf-8');
              const pmidMatches = content.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g);
              for (const m of pmidMatches) alreadyPmids.add(m[1]);
            } catch {}
          }
        }
      }
    }
    console.log(`Found ${alreadyPmids.size} already-summarized PMIDs from last 7 days`);
  } catch {
    alreadyPmids = new Set();
  }

  const allIds = new Set();

  const journalSet = JOURNALS.slice(0, 15).map(j =>
    `("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND ${j}`
  );

  const broadTopics = [
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (biomarker*[tiab] OR "alpha-synuclein"[tiab] OR "seed amplification"[tiab])',
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (depression[tiab] OR anxiety[tiab] OR psychosis[tiab] OR apathy[tiab])',
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (exercise[tiab] OR rehabilitation[tiab] OR gait[tiab] OR "deep brain stimulation"[tiab])',
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (nutrition[tiab] OR diet[tiab] OR microbiome[tiab] OR "gut-brain axis"[tiab])',
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (caregiver*[tiab] OR "quality of life"[tiab] OR stigma[tiab])',
    '("Parkinson Disease"[Mesh] OR Parkinson*[tiab]) AND (genetics[tiab] OR LRRK2[tiab] OR GBA1[tiab] OR SNCA[tiab])',
  ];

  const allQueries = [...journalSet, ...broadTopics];

  for (const query of allQueries) {
    try {
      const ids = await searchPubMed(query, DAYS);
      ids.forEach(id => allIds.add(id));
      console.log(`Query returned ${ids.length} results (total unique: ${allIds.size})`);
      await sleep(350);
    } catch (e) {
      console.error(`Query failed: ${e.message}`);
    }
  }

  const newIds = [...allIds].filter(id => !alreadyPmids.has(id));
  console.log(`Total unique PMIDs: ${allIds.size}, new (not in last 7 days): ${newIds.length}`);

  const limitedIds = newIds.slice(0, MAX_PAPERS);
  console.log(`Fetching details for ${limitedIds.length} papers...`);

  const papers = await fetchDetails(limitedIds);
  console.log(`Successfully parsed ${papers.length} papers`);

  const output = {
    date: REPORT_DATE,
    generated_at: new Date().toISOString(),
    total_fetched: papers.length,
    papers,
  };

  writeFileSync(JSON_OUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Saved to ${JSON_OUT}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
