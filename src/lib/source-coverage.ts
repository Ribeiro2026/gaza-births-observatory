import type { BirthReportRecord, CredibilityTier, SourceRecord } from '../types/observatory';

export interface SourceCoverageSummary {
  sourceId: number;
  latestMonthlyPeriod: string | null;
  earliestMonthlyPeriod: string | null;
  latestYearlyPeriod: string | null;
  monthsBehindHorizon: number | null;
  recencyLabel: string;
  recencyState: 'current' | 'lagging' | 'stale' | 'none';
  coveredMonthlyCount: number;
  expectedMonthlySpan: number;
  missingMonths: string[];
}

export interface TierDivergenceBenchmark {
  overlappingCount: number;
  avgAbsoluteGap: number;
  avgSignedDelta: number; // Tier 2 minus Tier 1
  avgPctGap: number;
  maxGapPeriod: string | null;
  maxGapValue: number;
  tier1Avg: number;
  tier2Avg: number;
}

function monthToIndex(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

function indexToMonth(idx: number): string {
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes reporting recency (relative to the latest monthly period in the dataset)
 * and identifies missing calendar months inside each source's active monthly span.
 */
export function computeSourceCoverageMap(
  sources: SourceRecord[],
  reports: BirthReportRecord[]
): Map<number, SourceCoverageSummary> {
  const monthlyReports = reports.filter(
    (r) => r.periodType === 'Monthly' && r.confidenceStatus !== 'Superseded'
  );

  let datasetHorizonIdx: number | null = null;
  for (const r of monthlyReports) {
    const idx = monthToIndex(r.periodValue);
    if (idx !== null && (datasetHorizonIdx === null || idx > datasetHorizonIdx)) {
      datasetHorizonIdx = idx;
    }
  }

  const bySource = new Map<number, BirthReportRecord[]>();
  for (const r of reports) {
    if (r.confidenceStatus === 'Superseded') continue;
    const list = bySource.get(r.sourceId) || [];
    list.push(r);
    bySource.set(r.sourceId, list);
  }

  const result = new Map<number, SourceCoverageSummary>();

  for (const src of sources) {
    const srcReports = bySource.get(src.id) || [];
    const monthlySet = new Set<number>();
    const yearlyPeriods: string[] = [];

    for (const r of srcReports) {
      if (r.periodType === 'Monthly') {
        const idx = monthToIndex(r.periodValue);
        if (idx !== null) monthlySet.add(idx);
      } else if (r.periodType === 'Yearly') {
        yearlyPeriods.push(r.periodValue);
      }
    }

    const sortedMonthlyIndices = Array.from(monthlySet).sort((a, b) => a - b);
    const latestYearlyPeriod =
      yearlyPeriods.length > 0
        ? [...yearlyPeriods].sort((a, b) => b.localeCompare(a))[0]
        : null;

    if (sortedMonthlyIndices.length === 0) {
      result.set(src.id, {
        sourceId: src.id,
        latestMonthlyPeriod: null,
        earliestMonthlyPeriod: null,
        latestYearlyPeriod,
        monthsBehindHorizon: null,
        recencyLabel: latestYearlyPeriod ? `Annual only (${latestYearlyPeriod})` : 'No active reports',
        recencyState: 'none',
        coveredMonthlyCount: 0,
        expectedMonthlySpan: 0,
        missingMonths: [],
      });
      continue;
    }

    const firstIdx = sortedMonthlyIndices[0];
    const lastIdx = sortedMonthlyIndices[sortedMonthlyIndices.length - 1];
    const spanEnd = datasetHorizonIdx !== null ? Math.max(lastIdx, datasetHorizonIdx) : lastIdx;
    const monthsBehind =
      datasetHorizonIdx !== null ? Math.max(0, datasetHorizonIdx - lastIdx) : 0;

    const missingMonths: string[] = [];
    for (let idx = firstIdx; idx <= spanEnd; idx++) {
      if (!monthlySet.has(idx)) {
        missingMonths.push(indexToMonth(idx));
      }
    }

    let recencyState: SourceCoverageSummary['recencyState'] = 'current';
    let recencyLabel = 'Up to date';
    if (monthsBehind === 1) {
      recencyState = 'lagging';
      recencyLabel = '1 month behind';
    } else if (monthsBehind === 2) {
      recencyState = 'lagging';
      recencyLabel = '2 months behind';
    } else if (monthsBehind >= 3) {
      recencyState = 'stale';
      recencyLabel = `${monthsBehind} months behind`;
    }

    result.set(src.id, {
      sourceId: src.id,
      latestMonthlyPeriod: indexToMonth(lastIdx),
      earliestMonthlyPeriod: indexToMonth(firstIdx),
      latestYearlyPeriod,
      monthsBehindHorizon: monthsBehind,
      recencyLabel,
      recencyState,
      coveredMonthlyCount: sortedMonthlyIndices.length,
      expectedMonthlySpan: spanEnd - firstIdx + 1,
      missingMonths,
    });
  }

  return result;
}

const TIER_1: CredibilityTier = 'Tier 1 - Primary Registry';
const TIER_2: CredibilityTier = 'Tier 2 - Multilateral';

/**
 * Benchmarks overlapping periods between Tier 1 primary registries and Tier 2
 * multilateral agency estimates to quantify systemic divergence.
 */
export function computeTier1VsTier2Divergence(
  reports: BirthReportRecord[],
  periodType: 'Monthly' | 'Yearly',
  yearFilter: string,
  confidenceScope: 'verified' | 'active' | 'all'
): TierDivergenceBenchmark | null {
  const tier1ByPeriod = new Map<string, number[]>();
  const tier2ByPeriod = new Map<string, number[]>();

  for (const r of reports) {
    if (r.periodType !== periodType) continue;
    if (yearFilter !== 'All' && !r.periodValue.startsWith(yearFilter)) continue;
    if (confidenceScope === 'verified' && r.confidenceStatus !== 'Verified') continue;
    if (confidenceScope === 'active' && r.confidenceStatus === 'Superseded') continue;

    if (r.sourceCredibilityTier === TIER_1) {
      const arr = tier1ByPeriod.get(r.periodValue) || [];
      arr.push(r.count);
      tier1ByPeriod.set(r.periodValue, arr);
    } else if (r.sourceCredibilityTier === TIER_2) {
      const arr = tier2ByPeriod.get(r.periodValue) || [];
      arr.push(r.count);
      tier2ByPeriod.set(r.periodValue, arr);
    }
  }

  let sumAbsGap = 0;
  let sumSignedDelta = 0;
  let sumPctGap = 0;
  let sumT1 = 0;
  let sumT2 = 0;
  let count = 0;
  let maxGapPeriod: string | null = null;
  let maxGapValue = 0;

  for (const [periodValue, t1Counts] of tier1ByPeriod.entries()) {
    const t2Counts = tier2ByPeriod.get(periodValue);
    if (!t2Counts || t2Counts.length === 0) continue;

    const t1Med = computeMedian(t1Counts);
    const t2Med = computeMedian(t2Counts);
    const signedDelta = t2Med - t1Med;
    const absGap = Math.abs(signedDelta);
    const pctGap = t1Med > 0 ? (absGap / t1Med) * 100 : 0;

    sumAbsGap += absGap;
    sumSignedDelta += signedDelta;
    sumPctGap += pctGap;
    sumT1 += t1Med;
    sumT2 += t2Med;
    count++;

    if (absGap > maxGapValue) {
      maxGapValue = absGap;
      maxGapPeriod = periodValue;
    }
  }

  if (count === 0) return null;

  return {
    overlappingCount: count,
    avgAbsoluteGap: Math.round(sumAbsGap / count),
    avgSignedDelta: Math.round(sumSignedDelta / count),
    avgPctGap: sumPctGap / count,
    maxGapPeriod,
    maxGapValue: Math.round(maxGapValue),
    tier1Avg: Math.round(sumT1 / count),
    tier2Avg: Math.round(sumT2 / count),
  };
}
