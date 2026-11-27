import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import crypto from 'node:crypto';
import { formatPeriodLabel } from '../lib/utils.ts';
import { validateSafePublicUrl } from './gemini-extractor.ts';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export type UrlHealthStatus =
  | 'live'
  | 'redirected'
  | 'restricted'
  | 'broken'
  | 'unreachable'
  | 'archival_placeholder';

export interface UrlCheckResult {
  originalUrl: string;
  finalUrl: string;
  status: UrlHealthStatus;
  statusCode: number | null;
  reachable: boolean;
  redirected: boolean;
  latencyMs: number;
  note: string;
  checkedAt: string;
}

export interface GroundedWebSource {
  title: string;
  uri: string;
  domain: string;
}

export interface SourceSearchVerificationResult {
  reportId: number;
  urlCheck: UrlCheckResult;
  grounding: {
    urlVerificationSummary: string;
    realtimeContext: string;
    searchQueries: string[];
    sources: GroundedWebSource[];
    generatedAt: string;
    model: string;
  } | null;
  groundingError?: {
    status: number;
    message: string;
  } | null;
  cached: boolean;
}

export interface VerifiableReportInput {
  id: number;
  sourceName: string;
  sourceType: string;
  sourceCredibilityTier: string;
  periodType: string;
  periodValue: string;
  count: number;
  publicationDate: Date | string;
  sourceUrl: string;
  rawTextSnippet: string;
  documentRef: string;
  confidenceStatus: string;
  updatedAt: Date | string;
}

export class SourceVerificationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'SourceVerificationError';
    this.statusCode = statusCode;
  }
}

interface CacheEntry {
  expiresAt: number;
  payload: SourceSearchVerificationResult;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const verificationCache = new Map<string, CacheEntry>();

const RATE_WINDOW_MS = 60 * 1000;
const MAX_VERIFICATIONS_PER_MINUTE = 12;
const verifyRateMap = new Map<string, number[]>();

export function checkVerificationRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const recent = (verifyRateMap.get(clientKey) || []).filter(
    (ts) => now - ts < RATE_WINDOW_MS
  );
  if (recent.length >= MAX_VERIFICATIONS_PER_MINUTE) {
    verifyRateMap.set(clientKey, recent);
    return false;
  }
  recent.push(now);
  verifyRateMap.set(clientKey, recent);
  return true;
}

function isSafeHttpUri(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractDomain(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

function toIsoDate(val: Date | string): string {
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
}

/**
 * Performs a safe, SSRF-protected reachability probe on an external publication URL.
 * Validates every redirect hop through validateSafePublicUrl.
 */
export async function probePublicationUrl(rawUrl: string): Promise<UrlCheckResult> {
  const checkedAt = new Date().toISOString();
  const trimmed = (rawUrl || '').trim();

  if (!trimmed) {
    return {
      originalUrl: rawUrl,
      finalUrl: rawUrl,
      status: 'archival_placeholder',
      statusCode: null,
      reachable: false,
      redirected: false,
      latencyMs: 0,
      note: 'No external URL recorded for this report.',
      checkedAt,
    };
  }

  // Detect internal archival placeholders cleanly without probing
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') {
      return {
        originalUrl: trimmed,
        finalUrl: trimmed,
        status: 'archival_placeholder',
        statusCode: null,
        reachable: false,
        redirected: false,
        latencyMs: 0,
        note: 'Internal archival placeholder link (not a live public URL).',
        checkedAt,
      };
    }
  } catch {
    return {
      originalUrl: trimmed,
      finalUrl: trimmed,
      status: 'unreachable',
      statusCode: null,
      reachable: false,
      redirected: false,
      latencyMs: 0,
      note: 'Stored source URL is not a valid web address.',
      checkedAt,
    };
  }

  let currentUrl: string;
  try {
    currentUrl = (await validateSafePublicUrl(trimmed)).toString();
  } catch (err) {
    return {
      originalUrl: trimmed,
      finalUrl: trimmed,
      status: 'unreachable',
      statusCode: null,
      reachable: false,
      redirected: false,
      latencyMs: 0,
      note: err instanceof Error ? err.message : 'External host could not be verified.',
      checkedAt,
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const attemptProbe = async (method: 'HEAD' | 'GET') => {
    let url = currentUrl;
    let hops = 0;
    let response: Response | null = null;

    for (let hop = 0; hop <= 3; hop++) {
      response = await fetch(url, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; GazaBirthsObservatory/1.0; Research URL Verifier)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) break;
        const resolvedNext = new URL(location, url).toString();
        url = (await validateSafePublicUrl(resolvedNext)).toString();
        hops += 1;
        continue;
      }

      // Discard body immediately — we only verify HTTP reachability & status
      await response.body?.cancel().catch(() => {});
      break;
    }

    return { response, finalUrl: url, hops };
  };

  try {
    let result = await attemptProbe('HEAD');
    // Some government/UN portals reject HEAD with 403/405/501; fallback once to GET
    if (
      result.response &&
      (result.response.status === 405 ||
        result.response.status === 403 ||
        result.response.status === 501)
    ) {
      result = await attemptProbe('GET');
    }

    const latencyMs = Date.now() - startedAt;
    const statusCode = result.response?.status ?? null;
    const redirected = result.hops > 0 && result.finalUrl !== trimmed;

    if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
      return {
        originalUrl: trimmed,
        finalUrl: result.finalUrl,
        status: redirected ? 'redirected' : 'live',
        statusCode,
        reachable: true,
        redirected,
        latencyMs,
        note: redirected
          ? `URL resolved via redirect (HTTP ${statusCode}) to ${extractDomain(result.finalUrl)}.`
          : `Publication URL responded cleanly (HTTP ${statusCode}).`,
        checkedAt,
      };
    }

    if (statusCode === 401 || statusCode === 403) {
      return {
        originalUrl: trimmed,
        finalUrl: result.finalUrl,
        status: 'restricted',
        statusCode,
        reachable: true,
        redirected,
        latencyMs,
        note: `Host is online (HTTP ${statusCode}), but restricts automated direct requests; check search grounding below.`,
        checkedAt,
      };
    }

    if (statusCode !== null && statusCode >= 400) {
      return {
        originalUrl: trimmed,
        finalUrl: result.finalUrl,
        status: 'broken',
        statusCode,
        reachable: false,
        redirected,
        latencyMs,
        note:
          statusCode === 404 || statusCode === 410
            ? `Page not found at archived URL (HTTP ${statusCode}). Check search grounding for a moved link or mirror.`
            : `Remote host returned HTTP ${statusCode}.`,
        checkedAt,
      };
    }

    return {
      originalUrl: trimmed,
      finalUrl: result.finalUrl,
      status: 'unreachable',
      statusCode,
      reachable: false,
      redirected,
      latencyMs,
      note: 'No HTTP status returned by remote publication host.',
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      originalUrl: trimmed,
      finalUrl: currentUrl,
      status: 'unreachable',
      statusCode: null,
      reachable: false,
      redirected: false,
      latencyMs,
      note: isTimeout
        ? 'Connection timed out after 8 seconds while probing publication URL.'
        : 'Remote host could not be reached directly (network or TLS error).',
      checkedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientGeminiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('429') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('ECONNRESET') ||
    raw.includes('ETIMEDOUT')
  );
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  let parsedCode: number | null = null;
  let parsedStatus = '';
  let parsedMessage = raw;

  try {
    const obj = JSON.parse(raw);
    if (obj?.error) {
      if (typeof obj.error.code === 'number') parsedCode = obj.error.code;
      if (typeof obj.error.status === 'string') parsedStatus = obj.error.status;
      if (typeof obj.error.message === 'string') parsedMessage = obj.error.message;
    }
  } catch {
    // Plain text message
  }

  if (parsedCode === 503 || parsedStatus === 'UNAVAILABLE' || raw.includes('503')) {
    return {
      status: 503,
      message:
        'Google Search grounding is temporarily experiencing high demand. Please retry shortly.',
    };
  }
  if (parsedCode === 429 || parsedStatus === 'RESOURCE_EXHAUSTED' || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Google Search grounding quota or rate limit was reached on the current API key. Wait briefly and retry, or select a billing-enabled API key in Settings > Secrets for higher search grounding quota.',
    };
  }
  if (
    parsedCode === 403 ||
    parsedStatus === 'PERMISSION_DENIED' ||
    raw.includes('API_KEY_INVALID')
  ) {
    return {
      status: 403,
      message: 'Gemini API authentication failed. Please check the API key in Settings > Secrets.',
    };
  }
  return {
    status: parsedCode && parsedCode >= 400 && parsedCode < 600 ? parsedCode : 500,
    message: parsedMessage || 'Google Search grounding request failed.',
  };
}

function parseGroundedSections(rawText: string): {
  urlVerificationSummary: string;
  realtimeContext: string;
} {
  const cleaned = rawText
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();

  const urlMatch = cleaned.match(
    /URL_STATUS_FINDINGS\s*:\s*([\s\S]*?)(?=REALTIME_CONTEXT\s*:|$)/i
  );
  const ctxMatch = cleaned.match(/REALTIME_CONTEXT\s*:\s*([\s\S]*)$/i);

  if (urlMatch && ctxMatch) {
    const urlPart = urlMatch[1].replace(/\s+/g, ' ').trim();
    const ctxPart = ctxMatch[1].replace(/\s+/g, ' ').trim();
    if (urlPart && ctxPart) {
      return {
        urlVerificationSummary: urlPart,
        realtimeContext: ctxPart,
      };
    }
  }

  // Fallback clean split by paragraphs if headers were omitted
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length >= 2) {
    return {
      urlVerificationSummary: paragraphs[0],
      realtimeContext: paragraphs.slice(1).join(' '),
    };
  }

  return {
    urlVerificationSummary:
      'Checked web search results for corroborating publisher bulletins and mirrors.',
    realtimeContext:
      paragraphs[0] || 'No additional live web context was returned for this record.',
  };
}

export async function verifyReportWithSearchGrounding(
  report: VerifiableReportInput,
  options: { forceRefresh?: boolean } = {}
): Promise<SourceSearchVerificationResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new SourceVerificationError(
      'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets.',
      500
    );
  }

  const fingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        id: report.id,
        sourceUrl: report.sourceUrl,
        count: report.count,
        periodValue: report.periodValue,
        updatedAt: String(report.updatedAt),
      })
    )
    .digest('hex');

  if (!options.forceRefresh) {
    const cached = verificationCache.get(fingerprint);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.payload,
        cached: true,
      };
    }
  }

  // 1. Direct safe HTTP reachability check on the archived publication URL
  const urlCheck = await probePublicationUrl(report.sourceUrl);

  // 2. Live Google Search grounding via Gemini
  const periodLabel = formatPeriodLabel(report.periodValue);
  const pubDate = toIsoDate(report.publicationDate);
  const modelName = 'gemini-4-hydrogen';

  const prompt = `You are verifying a demographic birth record archived in the Gaza Births Observatory using live Google Search results.

RECORD TO VERIFY:
- Publisher: ${report.sourceName} (${report.sourceType}, ${report.sourceCredibilityTier})
- Reporting Period: ${periodLabel} (${report.periodType}, code ${report.periodValue})
- Reported Birth Count: ${report.count.toLocaleString('en-US')}
- Publication Date: ${pubDate}
- Document Reference: ${report.documentRef}
- Archived Source URL: ${report.sourceUrl}
- Direct Server HTTP Probe Result: ${urlCheck.status.toUpperCase()} (${urlCheck.note})
- Archived Verbatim Excerpt: "${report.rawTextSnippet.slice(0, 600)}"

Use Google Search to check two things and respond in plain text using EXACTLY these two labeled sections (no markdown bullet lists, no bold asterisks):

URL_STATUS_FINDINGS: In 1–2 concise sentences, confirm whether this publisher's publication URL or an authoritative mirror/bulletin (such as ReliefWeb, UN OCHA, UNFPA, WHO, MOH, PCBS, or major news archive) is currently accessible or referenced online for this topic and period. If the direct URL was restricted, broken, or a placeholder, note whether live web sources corroborate or replace it.

REALTIME_CONTEXT: In 2–3 concise, strictly factual sentences, summarize real-time web context relevant to Gaza birth statistics around ${periodLabel} and ${report.sourceName} — including any corroborating or contrasting figures (such as daily/monthly averages, UN estimates, or official ministry updates), methodological context (hospital deliveries vs. civil registration backlogs), or subsequent revisions found in search results. Never fabricate numbers or URLs not supported by search results.`;

  let response;
  let lastError: unknown = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a careful demographic fact-checker and archival verifier. Ground every statement in live Google Search results, distinguish verified figures from uncorroborated claims, and keep your output concise, neutral, and publication-grade.',
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientGeminiError(err)) {
        const delayMs = 700 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }
  }

  if (lastError || !response) {
    const formatted = formatGeminiError(lastError);
    // Return the completed live URL probe alongside the exact upstream grounding error
    // (never caching failed grounding responses)
    return {
      reportId: report.id,
      urlCheck,
      grounding: null,
      groundingError: formatted,
      cached: false,
    };
  }

  const rawText = (response.text ?? '').trim();
  const { urlVerificationSummary, realtimeContext } = parseGroundedSections(rawText);

  const metadata = response.candidates?.[0]?.groundingMetadata;
  const rawChunks = metadata?.groundingChunks ?? [];
  const seenUris = new Set<string>();
  const sources: GroundedWebSource[] = [];

  for (const chunk of rawChunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || !isSafeHttpUri(uri) || seenUris.has(uri)) continue;
    seenUris.add(uri);
    const domain = extractDomain(uri);
    const title = chunk.web?.title?.trim() || domain;
    sources.push({ title, uri, domain });
  }

  const searchQueries = Array.isArray(metadata?.webSearchQueries)
    ? metadata.webSearchQueries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 5)
    : [];

  const payload: SourceSearchVerificationResult = {
    reportId: report.id,
    urlCheck,
    grounding: {
      urlVerificationSummary,
      realtimeContext,
      searchQueries,
      sources: sources.slice(0, 8),
      generatedAt: new Date().toISOString(),
      model: modelName,
    },
    groundingError: null,
    cached: false,
  };

  if (verificationCache.size > 80) {
    const now = Date.now();
    for (const [k, v] of verificationCache.entries()) {
      if (v.expiresAt <= now) verificationCache.delete(k);
    }
  }
  verificationCache.set(fingerprint, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });

  return payload;
}
