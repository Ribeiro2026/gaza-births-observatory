import { formatPeriodLabel } from './utils';
import type { BirthReportRecord, PeriodType } from '../types/observatory';

export interface ProjectedPeriodPoint {
  periodValue: string;
  label: string;
  estimate: number;
  low: number;
  high: number;
}

export interface ProjectionSummary {
  slopePerPeriod: number;
  rSquared: number;
  sampleSize: number;
  horizonSteps: number;
  unitLabel: 'month' | 'year';
  nextPoint: ProjectedPeriodPoint;
  cumulativeEstimate: number;
  cumulativeLow: number;
  cumulativeHigh: number;
}

export interface TrendProjectionResult {
  available: boolean;
  unavailableReason?: string;
  anchorPeriodValue?: string;
  anchorLabel?: string;
  anchorConsensusValue?: number;
  points: ProjectedPeriodPoint[];
  summary?: ProjectionSummary;
}

/**
 * Two-tailed 95% Student-t critical values by degrees of freedom (df = n - 2).
 */
function getTCritical95(df: number): number {
  const table: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    12: 2.179,
    15: 2.131,
    20: 2.086,
    25: 2.06,
    30: 2.042,
    40: 2.021,
    60: 2.0,
  };
  if (df <= 1) return table[1];
  if (table[df] !== undefined) return table[df];
  if (df > 60) return 1.96;

  // Linear interpolation between nearest tabulated df values
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (df > k0 && df < k1) {
      const frac = (df - k0) / (k1 - k0);
      return table[k0] + frac * (table[k1] - table[k0]);
    }
  }
  return 1.96;
}

function periodToTimeIndex(periodValue: string, periodType: PeriodType): number | null {
  if (periodType === 'Yearly') {
    const year = Number(periodValue.slice(0, 4));
    return Number.isInteger(year) ? year : null;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(periodValue);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

function timeIndexToPeriodValue(index: number, periodType: PeriodType): string {
  if (periodType === 'Yearly') {
    return String(index);
  }
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fits an Ordinary Least Squares (OLS) linear trend over the chronological consensus
 * median of the active birth reports and produces near-term point estimates with
 * 95% Student-t prediction intervals.
 */
export function computeLinearTrendProjection(
  reports: BirthReportRecord[],
  periodType: PeriodType,
  horizonSteps: number
): TrendProjectionResult {
  // Collapse multiple reports per source/period to latest publication first, then median across sources
  const byPeriodAndSource = new Map<string, Map<number, BirthReportRecord>>();
  for (const r of reports) {
    if (r.periodType !== periodType) continue;
    let sourceMap = byPeriodAndSource.get(r.periodValue);
    if (!sourceMap) {
      sourceMap = new Map<number, BirthReportRecord>();
      byPeriodAndSource.set(r.periodValue, sourceMap);
    }
    const existing = sourceMap.get(r.sourceId);
    if (
      !existing ||
      new Date(r.publicationDate).getTime() > new Date(existing.publicationDate).getTime()
    ) {
      sourceMap.set(r.sourceId, r);
    }
  }

  const series: Array<{ periodValue: string; t: number; y: number }> = [];
  for (const [periodValue, sourceMap] of byPeriodAndSource.entries()) {
    const t = periodToTimeIndex(periodValue, periodType);
    if (t === null) continue;
    const counts = Array.from(sourceMap.values()).map((r) => r.count);
    if (counts.length === 0) continue;
    series.push({
      periodValue,
      t,
      y: computeMedian(counts),
    });
  }

  series.sort((a, b) => a.t - b.t);

  const n = series.length;
  if (n < 3) {
    return {
      available: false,
      unavailableReason: `At least 3 historical ${
        periodType === 'Monthly' ? 'months' : 'years'
      } are required in the current filter scope to compute a linear trend projection (currently ${n}).`,
      points: [],
    };
  }

  const meanT = series.reduce((sum, p) => sum + p.t, 0) / n;
  const meanY = series.reduce((sum, p) => sum + p.y, 0) / n;

  let stt = 0;
  let sty = 0;
  let syy = 0;
  for (const p of series) {
    const dt = p.t - meanT;
    const dy = p.y - meanY;
    stt += dt * dt;
    sty += dt * dy;
    syy += dy * dy;
  }

  if (stt === 0) {
    return {
      available: false,
      unavailableReason: 'Historical observations must span multiple time periods.',
      points: [],
    };
  }

  const slope = sty / stt;
  const intercept = meanY - slope * meanT;

  let sse = 0;
  for (const p of series) {
    const fitted = intercept + slope * p.t;
    const residual = p.y - fitted;
    sse += residual * residual;
  }

  const df = n - 2;
  const residualStdErr = df > 0 ? Math.sqrt(sse / df) : 0;
  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : 1;
  const tCrit = getTCritical95(df);

  const last = series[n - 1];
  const points: ProjectedPeriodPoint[] = [];

  let cumulativeEstimate = 0;
  let cumulativeLow = 0;
  let cumulativeHigh = 0;

  for (let step = 1; step <= horizonSteps; step++) {
    const nextT = last.t + step;
    const periodValue = timeIndexToPeriodValue(nextT, periodType);
    const rawEstimate = Math.max(0, intercept + slope * nextT);
    const sePred =
      residualStdErr * Math.sqrt(1 + 1 / n + ((nextT - meanT) ** 2) / stt);
    const margin = tCrit * sePred;

    const estimate = Math.round(rawEstimate);
    const low = Math.max(0, Math.round(rawEstimate - margin));
    const high = Math.max(estimate, Math.round(rawEstimate + margin));

    cumulativeEstimate += estimate;
    cumulativeLow += low;
    cumulativeHigh += high;

    points.push({
      periodValue,
      label: formatPeriodLabel(periodValue),
      estimate,
      low,
      high,
    });
  }

  return {
    available: true,
    anchorPeriodValue: last.periodValue,
    anchorLabel: formatPeriodLabel(last.periodValue),
    anchorConsensusValue: Math.round(last.y),
    points,
    summary: {
      slopePerPeriod: slope,
      rSquared,
      sampleSize: n,
      horizonSteps,
      unitLabel: periodType === 'Monthly' ? 'month' : 'year',
      nextPoint: points[0],
      cumulativeEstimate,
      cumulativeLow,
      cumulativeHigh,
    },
  };
}
