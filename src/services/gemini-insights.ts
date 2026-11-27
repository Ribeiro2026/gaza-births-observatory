import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import crypto from 'node:crypto';
import { analyzeDiscrepancies, type DiscrepancyCase } from '../lib/discrepancy-engine.ts';
import type {
  BirthReportRecord,
  ConfidenceStatus,
  CredibilityTier,
  PeriodType,
  SourceType,
} from '../types/observatory.ts';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export type DataQualityTrend = 'Improving' | 'Stable' | 'Diverging' | 'Mixed';

export interface AnalyzedPeriodDigest {
  periodValue: string;
  periodLabel: string;
  periodType: PeriodType;
  severity: 'High' | 'Moderate' | 'Low';
  spread: number;
  spreadPct: number;
  pubSpanDays: number;
  sourceCount: number;
  flags: string[];
  topReportId: number;
}

export interface DiscrepancyInsightsPayload {
  sentences: [string, string, string];
  summary: string;
  qualityTrend: DataQualityTrend;
  periodScope: 'All' | PeriodType;
  windowCount: number;
  analyzedCount: number;
  periodRangeLabel: string;
  highSeverityCount: number;
  avgSpreadPct: number;
  avgPubSpanDays: number;
  widestCase: {
    periodValue: string;
    periodLabel: string;
    spread: number;
    spreadPct: number;
    minSource: string;
    maxSource: string;
    reportId: number;
  } | null;
  analyzedPeriods: AnalyzedPeriodDigest[];
  generatedAt: string;
  cached: boolean;
  model: string;
}

interface RawDbReportRow {
  id: number;
  sourceId: number;
  periodType: string;
  periodValue: string;
  count: number;
  publicationDate: Date | string;
  sourceUrl: string;
  rawTextSnippet: string;
  documentRef: string;
  confidenceStatus: string;
  archivedAt: Date | string;
  updatedAt: Date | string;
  sourceName: string;
  sourceType: string;
  sourceCredibilityTier: string;
  sourceColor: string;
  sourceHandle: string;
  revisionCount: number;
}

interface RawDbRevisionRow {
  id: number;
  birthReportId: number;
  previousValue: number;
  newValue: number;
  changeReason: string;
  detectedAt: Date | string;
  detectedBy: string;
  sourceName: string | null;
  periodValue: string | null;
}

interface CacheEntry {
  expiresAt: number;
  payload: DiscrepancyInsightsPayload;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const insightCache = new Map<string, CacheEntry>();

const REFRESH_WINDOW_MS = 60 * 1000;
const MAX_FORCED_REFRESHES_PER_MINUTE = 6;
const refreshRateMap = new Map<string, number[]>();

export function checkRefreshRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const recent = (refreshRateMap.get(clientKey) || []).filter(
    (ts) => now - ts < REFRESH_WINDOW_MS
  );
  if (recent.length >= MAX_FORCED_REFRESHES_PER_MINUTE) {
    refreshRateMap.set(clientKey, recent);
    return false;
  }
  recent.push(now);
  refreshRateMap.set(clientKey, recent);
  return true;
}

function toIsoString(val: Date | string): string {
  if (val instanceof Date) return val.toISOString();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? String(val) : d.toISOString();
}

function normalizeDbReports(rows: RawDbReportRow[]): BirthReportRecord[] {
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    periodType: (row.periodType === 'Yearly' ? 'Yearly' : 'Monthly') as PeriodType,
    periodValue: row.periodValue,
    count: row.count,
    publicationDate: toIsoString(row.publicationDate),
    sourceUrl: row.sourceUrl,
    rawTextSnippet: row.rawTextSnippet,
    documentRef: row.documentRef,
    confidenceStatus: row.confidenceStatus as ConfidenceStatus,
    archivedAt: toIsoString(row.archivedAt),
    updatedAt: toIsoString(row.updatedAt),
    sourceName: row.sourceName,
    sourceType: row.sourceType as SourceType,
    sourceCredibilityTier: row.sourceCredibilityTier as CredibilityTier,
    sourceColor: row.sourceColor,
    sourceHandle: row.sourceHandle,
    revisionCount: row.revisionCount,
  }));
}

function normalizeThreeSentences(rawSentences: unknown): [string, string, string] | null {
  if (!Array.isArray(rawSentences)) return null;
  const cleaned = rawSentences
    .map((s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''))
    .filter((s) => s.length > 0)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));

  if (cleaned.length === 3) {
    return [cleaned[0], cleaned[1], cleaned[2]];
  }
  if (cleaned.length > 3) {
    return [cleaned[0], cleaned[1], cleaned.slice(2).join(' ')];
  }
  if (cleaned.length > 0) {
    // Split combined paragraph on sentence boundaries if the model grouped them
    const split = cleaned
      .join(' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (split.length >= 3) {
      return [split[0], split[1], split.slice(2).join(' ')];
    }
  }
  return null;
}

function formatUpstreamGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  let parsedMessage = raw;
  let parsedCode: number | null = null;
  let parsedStatus = '';

  try {
    const obj = JSON.parse(raw);
    if (obj?.error) {
      if (typeof obj.error.message === 'string') parsedMessage = obj.error.message;
      if (typeof obj.error.code === 'number') parsedCode = obj.error.code;
      if (typeof obj.error.status === 'string') parsedStatus = obj.error.status;
    }
  } catch {
    // Raw message is plain text
  }

  if (parsedCode === 503 || parsedStatus === 'UNAVAILABLE' || raw.includes('503')) {
    return {
      status: 503,
      message:
        'Gemini is temporarily experiencing high demand. Please retry in a few moments.',
    };
  }
  if (parsedCode === 429 || parsedStatus === 'RESOURCE_EXHAUSTED' || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini rate limit reached. Please wait briefly before refreshing AI Insights.',
    };
  }
  if (
    parsedCode === 403 ||
    parsedStatus === 'PERMISSION_DENIED' ||
    raw.includes('API_KEY_INVALID')
  ) {
    return {
      status: 403,
      message:
        'Gemini API authentication failed. Please check the API key in Settings > Secrets.',
    };
  }
  return {
    status: parsedCode && parsedCode >= 400 && parsedCode < 600 ? parsedCode : 500,
    message: parsedMessage || 'Failed to generate AI discrepancy insights.',
  };
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

export class GeminiInsightsError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'GeminiInsightsError';
    this.statusCode = statusCode;
  }
}

function buildCasePromptRecord(c: DiscrepancyCase) {
  return {
    period: c.periodLabel,
    periodCode: c.periodValue,
    granularity: c.periodType,
    severity: c.severity,
    flags: c.flagLabels,
    medianBirths: c.medianCount,
    spread: c.spread,
    spreadPct: Number(c.spreadPct.toFixed(1)),
    publicationLagDays: c.pubSpanDays,
    statusMix: c.statusSummary,
    sources: c.reports.map(({ report, deltaFromMedian, lagFromEarliestDays }) => ({
      name: report.sourceName,
      tier: report.sourceCredibilityTier,
      count: report.count,
      deltaFromMedian,
      status: report.confidenceStatus,
      publicationDate: report.publicationDate.slice(0, 10),
      lagDays: lagFromEarliestDays,
    })),
  };
}

export async function generateDiscrepancyInsightsWithGemini(input: {
  rawReports: RawDbReportRow[];
  rawRevisions: RawDbRevisionRow[];
  periodScope: 'All' | PeriodType;
  windowCount: number;
  forceRefresh?: boolean;
}): Promise<DiscrepancyInsightsPayload> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets.'
    );
  }

  const normalizedReports = normalizeDbReports(input.rawReports);
  const audit = analyzeDiscrepancies(normalizedReports, { includeSuperseded: false });

  const scopedCases = audit.cases.filter((c) =>
    input.periodScope === 'All' ? true : c.periodType === input.periodScope
  );

  // Select the most recent discrepancy reports chronologically
  const recentCases = [...scopedCases]
    .sort((a, b) => {
      const cmp = b.periodValue.localeCompare(a.periodValue);
      if (cmp !== 0) return cmp;
      return b.spreadPct - a.spreadPct;
    })
    .slice(0, input.windowCount);

  if (recentCases.length === 0) {
    throw new Error(
      `No flagged discrepancy reports were found for the selected ${
        input.periodScope === 'All' ? 'dataset' : input.periodScope.toLowerCase()
      } scope.`
    );
  }

  const chronologicalCases = [...recentCases].sort((a, b) =>
    a.periodValue.localeCompare(b.periodValue)
  );
  const earliestLabel = chronologicalCases[0].periodLabel;
  const latestLabel = chronologicalCases[chronologicalCases.length - 1].periodLabel;
  const periodRangeLabel =
    earliestLabel === latestLabel ? latestLabel : `${earliestLabel} – ${latestLabel}`;

  const periodValueSet = new Set(recentCases.map((c) => c.periodValue));
  const relevantRevisions = input.rawRevisions
    .filter((rev) => rev.periodValue && periodValueSet.has(rev.periodValue))
    .slice(0, 10)
    .map((rev) => ({
      period: rev.periodValue,
      source: rev.sourceName || 'Unknown',
      previousValue: rev.previousValue,
      newValue: rev.newValue,
      delta: rev.newValue - rev.previousValue,
      reason: rev.changeReason,
    }));

  // Deterministic fingerprint for automatic cache invalidation when underlying records change
  const fingerprintSource = JSON.stringify({
    scope: input.periodScope,
    windowCount: input.windowCount,
    cases: recentCases.map((c) => ({
      key: c.key,
      spread: c.spread,
      pubSpanDays: c.pubSpanDays,
      statusSummary: c.statusSummary,
      reports: c.reports.map((r) => [
        r.report.id,
        r.report.count,
        r.report.confidenceStatus,
        r.report.updatedAt,
      ]),
    })),
    revisions: relevantRevisions,
  });

  const cacheKey = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

  if (!input.forceRefresh) {
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.payload,
        cached: true,
      };
    }
  }

  const highSeverityCount = recentCases.filter((c) => c.severity === 'High').length;
  const avgSpreadPct =
    recentCases.reduce((sum, c) => sum + c.spreadPct, 0) / recentCases.length;
  const avgPubSpanDays = Math.round(
    recentCases.reduce((sum, c) => sum + c.pubSpanDays, 0) / recentCases.length
  );

  const widest = [...recentCases].sort((a, b) => b.spread - a.spread)[0] || null;
  const analyzedPeriods: AnalyzedPeriodDigest[] = recentCases.map((c) => ({
    periodValue: c.periodValue,
    periodLabel: c.periodLabel,
    periodType: c.periodType,
    severity: c.severity,
    spread: c.spread,
    spreadPct: Number(c.spreadPct.toFixed(1)),
    pubSpanDays: c.pubSpanDays,
    sourceCount: c.sourceCount,
    flags: c.flagLabels,
    topReportId: c.maxReport.id,
  }));

  const structuredData = {
    periodScope: input.periodScope,
    periodRange: periodRangeLabel,
    analyzedPeriodsCount: recentCases.length,
    highSeverityPeriods: highSeverityCount,
    averageCountSpreadPct: Number(avgSpreadPct.toFixed(1)),
    averagePublicationLagDays: avgPubSpanDays,
    recentDiscrepanciesChronological: chronologicalCases.map(buildCasePromptRecord),
    recentRevisionsInWindow: relevantRevisions,
  };

  const prompt = `Analyze these ${recentCases.length} most recent discrepancy reports from the Gaza Births Observatory covering ${periodRangeLabel}, and produce a crisp 3-sentence executive summary of data quality trends for this period.

Requirements:
- Return EXACTLY 3 concise, high-signal executive sentences in the "sentences" array (each sentence ~18–32 words, plain institutional English, no markdown, no bullet prefixes).
- Sentence 1: Summarize the overall trajectory and magnitude of inter-source birth-count variance across ${periodRangeLabel}, referencing specific periods or percentage spreads from the data.
- Sentence 2: Identify the main structural drivers of discrepancies in this window (such as Tier 1 primary registries vs. Tier 2 multilateral estimates, Tier 3 media variance, publication lag days, or disputed/pending statuses).
- Sentence 3: State the concrete data quality takeaway or reconciliation priority (referencing recent revisions or the highest-variance period needing review).
- Strictly use ONLY numbers, source names, and periods present in the JSON below. Never invent external figures or facts.
- Classify "qualityTrend" as one of: "Improving", "Stable", "Diverging", or "Mixed".

DISCREPANCY DATA:
${JSON.stringify(structuredData, null, 2)}`;

  const modelName = 'gemini-4-hydrogen';

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
            'You are a senior demographic data-quality auditor writing concise, factual executive briefs for researchers. Output strictly valid JSON conforming to the schema.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              qualityTrend: {
                type: Type.STRING,
                description:
                  'Overall data quality trajectory across the analyzed window: "Improving", "Stable", "Diverging", or "Mixed".',
              },
              sentences: {
                type: Type.ARRAY,
                description:
                  'Exactly 3 concise, factual executive summary sentences describing the data quality trends for the analyzed discrepancy window.',
                items: {
                  type: Type.STRING,
                },
              },
            },
            required: ['qualityTrend', 'sentences'],
          },
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
    const formatted = formatUpstreamGeminiError(lastError);
    throw new GeminiInsightsError(formatted.message, formatted.status);
  }

  const rawJson = (response.text ?? '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    throw new Error('Gemini returned malformed JSON while generating discrepancy insights.');
  }

  const sentences = normalizeThreeSentences(parsed.sentences);
  if (!sentences) {
    throw new Error('Gemini did not return a valid 3-sentence executive summary.');
  }

  const validTrends = new Set<DataQualityTrend>([
    'Improving',
    'Stable',
    'Diverging',
    'Mixed',
  ]);
  const rawTrend = String(parsed.qualityTrend ?? 'Mixed') as DataQualityTrend;
  const qualityTrend: DataQualityTrend = validTrends.has(rawTrend) ? rawTrend : 'Mixed';

  const payload: DiscrepancyInsightsPayload = {
    sentences,
    summary: sentences.join(' '),
    qualityTrend,
    periodScope: input.periodScope,
    windowCount: input.windowCount,
    analyzedCount: recentCases.length,
    periodRangeLabel,
    highSeverityCount,
    avgSpreadPct: Number(avgSpreadPct.toFixed(1)),
    avgPubSpanDays,
    widestCase: widest
      ? {
          periodValue: widest.periodValue,
          periodLabel: widest.periodLabel,
          spread: widest.spread,
          spreadPct: Number(widest.spreadPct.toFixed(1)),
          minSource: widest.minReport.sourceName,
          maxSource: widest.maxReport.sourceName,
          reportId: widest.maxReport.id,
        }
      : null,
    analyzedPeriods,
    generatedAt: new Date().toISOString(),
    cached: false,
    model: modelName,
  };

  // Prune stale cache entries if map grows
  if (insightCache.size > 40) {
    const now = Date.now();
    for (const [k, v] of insightCache.entries()) {
      if (v.expiresAt <= now) insightCache.delete(k);
    }
  }
  insightCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });

  return payload;
}
