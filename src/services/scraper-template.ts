export const SCRAPER_CRON_TEMPLATE = `#!/usr/bin/env tsx
/**
 * Gaza Births Observatory — Automated Ingestion & Monitoring Worker
 *
 * Schedule via Cron or GitHub Actions (e.g. every 6 hours: "0 */6 * * *"):
 *   GEMINI_API_KEY=... OBSERVATORY_API_URL=https://your-app/api/ingest/extract-text \\
 *   OBSERVATORY_AUTH_TOKEN=... tsx gaza-births-worker.ts
 *
 * Monitors:
 *  1. ReliefWeb / UN OCHA / UNFPA RSS Feeds
 *  2. Public Telegram Web Channels (https://t.me/s/<channel_handle>)
 *  3. News media RSS endpoints
 *
 * Applies fast keyword/regex pre-filtering (English & Arabic birth terms),
 * calls Gemini structured JSON extraction, and submits candidates to the
 * Observatory "Needs Review" staging queue for deduplication & human approval.
 */

import { GoogleGenAI, Type } from '@google/genai';

interface FeedTarget {
  sourceName: string;
  kind: 'rss' | 'telegram_web';
  url: string;
}

const TARGET_FEEDS: FeedTarget[] = [
  {
    sourceName: 'UN OCHA',
    kind: 'rss',
    url: 'https://reliefweb.int/updates/rss.xml?advanced-search=(PC180)_(T4595)',
  },
  {
    sourceName: 'Al Jazeera',
    kind: 'rss',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
  },
  {
    sourceName: 'MOH Official Telegram',
    kind: 'telegram_web',
    url: 'https://t.me/s/MOHMediaGaza',
  },
];

// Fast bilingual regex pre-filter to skip irrelevant dispatches before LLM call
const BIRTH_KEYWORDS_RE =
  /(\\bbirths?\\b|\\bnewborns?\\b|\\bdeliveries\\b|\\bmaternity\\b|\\blive births?\\b|مواليد|ولادة|الولادات|مولود)/i;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
});

function extractTextBlocks(htmlOrXml: string, kind: FeedTarget['kind']): string[] {
  if (kind === 'rss') {
    const items = htmlOrXml.match(/<item[\\s\\S]*?<\\/item>/gi) || [];
    return items.map((block) =>
      block
        .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim()
    );
  }
  // Public Telegram web preview (<div class="tgme_widget_message_text ...">)
  const posts =
    htmlOrXml.match(/<div class="tgme_widget_message_text[^"]*"[\\s\\S]*?<\\/div>/gi) || [];
  return posts.map((post) =>
    post
      .replace(/<br\\s*\\/?>/gi, '\\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
  );
}

async function parseWithGemini(sourceName: string, url: string, snippetBlock: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: \`Extract Gaza birth statistics from this \${sourceName} item. Return [] if no explicit birth count is present.\\n\\n\${snippetBlock}\`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            period_type: { type: Type.STRING },
            period: { type: Type.STRING },
            count: { type: Type.INTEGER },
            source_date: { type: Type.STRING },
            document_ref: { type: Type.STRING },
            snippet: { type: Type.STRING },
          },
          required: ['period_type', 'period', 'count', 'source_date', 'snippet'],
        },
      },
    },
  });

  return JSON.parse(response.text ?? '[]');
}

async function runIngestionCycle() {
  for (const target of TARGET_FEEDS) {
    console.log(\`[Worker] Polling \${target.sourceName}: \${target.url}\`);
    const res = await fetch(target.url, {
      headers: { 'User-Agent': 'GazaBirthsObservatoryWorker/1.0' },
    });
    if (!res.ok) {
      console.warn(\`[Worker] Skipped \${target.sourceName} (HTTP \${res.status})\`);
      continue;
    }

    const body = await res.text();
    const candidates = extractTextBlocks(body, target.kind).filter((txt) =>
      BIRTH_KEYWORDS_RE.test(txt)
    );

    console.log(\`[Worker] Found \${candidates.length} birth-related items in \${target.sourceName}\`);

    for (const block of candidates.slice(0, 10)) {
      const extracted = await parseWithGemini(target.sourceName, target.url, block);
      if (extracted.length > 0 && process.env.OBSERVATORY_API_URL) {
        await fetch(process.env.OBSERVATORY_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: \`Bearer \${process.env.OBSERVATORY_AUTH_TOKEN || ''}\`,
          },
          body: JSON.stringify({
            rawText: block,
            sourceUrl: target.url,
            sourceHint: target.sourceName,
          }),
        });
      }
    }
  }
}

runIngestionCycle().catch((err) => {
  console.error('[Worker] Fatal ingestion error:', err);
  process.exit(1);
});
`;
