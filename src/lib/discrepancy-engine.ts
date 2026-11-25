import { formatDateShort, formatNumber, formatPeriodLabel } from './utils';
import type {
  BirthReportRecord,
  ConfidenceStatus,
  PeriodType,
} from '../types/observatory';

export type ConflictFlagType =
  | 'count-spread'
  | 'status-conflict'
  | 'pub-lag'
  | 'duplicate-source';

export type ConflictSeverity = 'High' | 'Moderate' | 'Low';

export interface EnrichedConflictReport {
  report: BirthReportRecord;
  deltaFromMedian: number;
  pctFromMedian: number;
  lagFromEarliestDays: number;
  positionRatio: number; // 0..1 position between period min and max
  isMin: boolean;
  isMax: boolean;
  isDuplicateSource: boolean;
}

export interface DiscrepancyCase {
  key: string;
  periodType: PeriodType;
  periodValue: string;
  periodLabel: string;
  severity: ConflictSeverity;
  flags: ConflictFlagType[];
  flagLabels: string[];
  reports: EnrichedConflictReport[];
  sourceCount: number;
  uniqueSourceCount: number;
  minReport: BirthReportRecord;
  maxReport: BirthReportRecord;
  medianCount: number;
  spread: number;
  spreadPct: number;
  pubSpanDays: number;
  earliestPubDate: string;
  latestPubDate: string;
  statusBreakdown: Array<{ status: ConfidenceStatus; count: number }>;
  statusSummary: string;
  duplicateSourceNames: string[];
}

export interface DiscrepancyAuditSummary {
  cases: DiscrepancyCase[];
  totalMultiSourcePeriods: number;
  totalFlaggedPeriods: number;
  highSeverityCount: number;
  countSpreadCount: number;
  statusConflictCount: number;
  pubLagCount: number;
  widestSpreadCase: DiscrepancyCase | null;
  longestLagCase: DiscrepancyCase | null;
}

const MONTHLY_LAG_THRESHOLD_DAYS = 21;
const YEARLY_LAG_THRESHOLD_DAYS = 60;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function computeMedian(sortedNumbers: number[]): number {
  const n = sortedNumbers.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedNumbers[mid];
  return Math.round((sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2);
}

export function analyzeDiscrepancies(
  allReports: BirthReportRecord[],
  options: { includeSuperseded?: boolean } = {}
): DiscrepancyAuditSummary {
  const { includeSuperseded = false } = options;

  const scopedReports = includeSuperseded
    ? allReports
    : allReports.filter((r) => r.confidenceStatus !== 'Superseded');

  const grouped = new Map<string, BirthReportRecord[]>();
  for (const r of scopedReports) {
    const key = `${r.periodType}::${r.periodValue}`;
    const list = grouped.get(key) || [];
    list.push(r);
    grouped.set(key, list);
  }

  let totalMultiSourcePeriods = 0;
  const cases: DiscrepancyCase[] = [];

  for (const [key, list] of grouped.entries()) {
    if (list.length < 2) {
      // Single report still flagged if explicitly marked Disputed
      if (list.length === 1 && list[0].confidenceStatus === 'Disputed') {
        const only = list[0];
        cases.push({
          key,
          periodType: only.periodType,
          periodValue: only.periodValue,
          periodLabel: formatPeriodLabel(only.periodValue),
          severity: 'Moderate',
          flags: ['status-conflict'],
          flagLabels: ['Disputed figure'],
          reports: [
            {
              report: only,
              deltaFromMedian: 0,
              pctFromMedian: 0,
              lagFromEarliestDays: 0,
              positionRatio: 0.5,
              isMin: true,
              isMax: true,
              isDuplicateSource: false,
            },
          ],
          sourceCount: 1,
          uniqueSourceCount: 1,
          minReport: only,
          maxReport: only,
          medianCount: only.count,
          spread: 0,
          spreadPct: 0,
          pubSpanDays: 0,
          earliestPubDate: only.publicationDate,
          latestPubDate: only.publicationDate,
          statusBreakdown: [{ status: 'Disputed', count: 1 }],
          statusSummary: '1 Disputed',
          duplicateSourceNames: [],
        });
      }
      continue;
    }

    totalMultiSourcePeriods += 1;

    const sortedByCount = [...list].sort((a, b) => a.count - b.count);
    const minReport = sortedByCount[0];
    const maxReport = sortedByCount[sortedByCount.length - 1];
    const spread = maxReport.count - minReport.count;
    const spreadPct = minReport.count > 0 ? (spread / minReport.count) * 100 : 0;
    const medianCount = computeMedian(sortedByCount.map((r) => r.count));

    // Duplicate publisher records within the exact same period
    const sourceFrequency = new Map<number, { name: string; count: number }>();
    for (const r of list) {
      const prev = sourceFrequency.get(r.sourceId);
      sourceFrequency.set(r.sourceId, {
        name: r.sourceName,
        count: (prev?.count || 0) + 1,
      });
    }
    const duplicateSourceIds = new Set<number>();
    const duplicateSourceNames: string[] = [];
    for (const [sid, info] of sourceFrequency.entries()) {
      if (info.count > 1) {
        duplicateSourceIds.add(sid);
        duplicateSourceNames.push(info.name);
      }
    }

    // Verification status conflict check
    const statusMap = new Map<ConfidenceStatus, number>();
    for (const r of list) {
      statusMap.set(r.confidenceStatus, (statusMap.get(r.confidenceStatus) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
    const statusSummary = statusBreakdown
      .map((s) => `${s.count} ${s.status}`)
      .join(' · ');
    const hasDisputed = statusMap.has('Disputed');
    const hasMixedStatuses = statusMap.size > 1;
    const hasStatusConflict = hasDisputed || hasMixedStatuses;

    // Publication lag anomaly check
    const pubTimes = list
      .map((r) => ({ report: r, ms: new Date(r.publicationDate).getTime() }))
      .filter((x) => Number.isFinite(x.ms))
      .sort((a, b) => a.ms - b.ms);
    const earliestMs = pubTimes[0]?.ms ?? 0;
    const latestMs = pubTimes[pubTimes.length - 1]?.ms ?? earliestMs;
    const pubSpanDays =
      pubTimes.length >= 2 ? Math.round((latestMs - earliestMs) / MS_PER_DAY) : 0;
    const lagThreshold =
      list[0].periodType === 'Yearly'
        ? YEARLY_LAG_THRESHOLD_DAYS
        : MONTHLY_LAG_THRESHOLD_DAYS;
    const hasPubLag = pubSpanDays >= lagThreshold;

    const hasCountSpread = spread > 0;
    const hasDuplicateSource = duplicateSourceIds.size > 0;

    const flags: ConflictFlagType[] = [];
    const flagLabels: string[] = [];

    if (hasCountSpread) {
      flags.push('count-spread');
      flagLabels.push(`Count spread (${spreadPct.toFixed(1)}%)`);
    }
    if (hasDuplicateSource) {
      flags.push('duplicate-source');
      flagLabels.push('Duplicate publisher entry');
    }
    if (hasStatusConflict) {
      flags.push('status-conflict');
      flagLabels.push(hasDisputed ? 'Disputed status conflict' : 'Mixed verification status');
    }
    if (hasPubLag) {
      flags.push('pub-lag');
      flagLabels.push(`Publication lag (${pubSpanDays}d span)`);
    }

    if (flags.length === 0) continue;

    // Deterministic severity classification
    let severity: ConflictSeverity = 'Low';
    if (
      spreadPct >= 12 ||
      hasDuplicateSource ||
      (hasDisputed && spreadPct >= 5)
    ) {
      severity = 'High';
    } else if (
      spreadPct >= 5 ||
      hasStatusConflict ||
      pubSpanDays >= (list[0].periodType === 'Yearly' ? 90 : 30)
    ) {
      severity = 'Moderate';
    }

    // Order rows inside side-by-side diff from highest reported count to lowest
    const enrichedReports: EnrichedConflictReport[] = [...list]
      .sort((a, b) => b.count - a.count)
      .map((r) => {
        const deltaFromMedian = r.count - medianCount;
        const pctFromMedian = medianCount > 0 ? (deltaFromMedian / medianCount) * 100 : 0;
        const ms = new Date(r.publicationDate).getTime();
        const lagFromEarliestDays =
          Number.isFinite(ms) && earliestMs > 0
            ? Math.max(0, Math.round((ms - earliestMs) / MS_PER_DAY))
            : 0;
        const positionRatio =
          spread > 0 ? (r.count - minReport.count) / spread : 0.5;

        return {
          report: r,
          deltaFromMedian,
          pctFromMedian,
          lagFromEarliestDays,
          positionRatio,
          isMin: r.count === minReport.count && spread > 0,
          isMax: r.count === maxReport.count && spread > 0,
          isDuplicateSource: duplicateSourceIds.has(r.sourceId),
        };
      });

    cases.push({
      key,
      periodType: list[0].periodType,
      periodValue: list[0].periodValue,
      periodLabel: formatPeriodLabel(list[0].periodValue),
      severity,
      flags,
      flagLabels,
      reports: enrichedReports,
      sourceCount: list.length,
      uniqueSourceCount: sourceFrequency.size,
      minReport,
      maxReport,
      medianCount,
      spread,
      spreadPct,
      pubSpanDays,
      earliestPubDate: pubTimes[0]?.report.publicationDate || list[0].publicationDate,
      latestPubDate:
        pubTimes[pubTimes.length - 1]?.report.publicationDate || list[0].publicationDate,
      statusBreakdown,
      statusSummary,
      duplicateSourceNames,
    });
  }

  // Default order: highest variance %, then newest period
  cases.sort((a, b) => {
    const sevRank = { High: 3, Moderate: 2, Low: 1 };
    if (sevRank[b.severity] !== sevRank[a.severity]) {
      return sevRank[b.severity] - sevRank[a.severity];
    }
    if (b.spreadPct !== a.spreadPct) return b.spreadPct - a.spreadPct;
    return b.periodValue.localeCompare(a.periodValue);
  });

  const countSpreadCases = cases.filter((c) => c.flags.includes('count-spread'));
  const statusConflictCases = cases.filter((c) => c.flags.includes('status-conflict'));
  const pubLagCases = cases.filter((c) => c.flags.includes('pub-lag'));

  const widestSpreadCase =
    [...countSpreadCases].sort((a, b) => b.spread - a.spread)[0] || null;
  const longestLagCase =
    [...pubLagCases].sort((a, b) => b.pubSpanDays - a.pubSpanDays)[0] || null;

  return {
    cases,
    totalMultiSourcePeriods,
    totalFlaggedPeriods: cases.length,
    highSeverityCount: cases.filter((c) => c.severity === 'High').length,
    countSpreadCount: countSpreadCases.length,
    statusConflictCount: statusConflictCases.length,
    pubLagCount: pubLagCases.length,
    widestSpreadCase,
    longestLagCase,
  };
}

/**
 * RFC-4180 CSV cell escaping with spreadsheet formula-injection protection.
 */
function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportDiscrepanciesToCsv(cases: DiscrepancyCase[], filename?: string): void {
  const headers = [
    'Period',
    'Period Code',
    'Granularity',
    'Severity',
    'Conflict Flags',
    'Sources Compared',
    'Min Reported Births',
    'Min Source',
    'Max Reported Births',
    'Max Source',
    'Median Births',
    'Absolute Spread',
    'Variance %',
    'Publication Span (Days)',
    'Earliest Publication',
    'Latest Publication',
    'Verification Status Mix',
    'Source Breakdown',
  ];

  const rows = cases.map((c) => {
    const breakdown = c.reports
      .map(
        ({ report }) =>
          `${report.sourceName}: ${formatNumber(report.count)} (${report.confidenceStatus}, ${formatDateShort(report.publicationDate)}, ${report.documentRef})`
      )
      .join(' | ');

    return [
      c.periodLabel,
      c.periodValue,
      c.periodType,
      c.severity,
      c.flagLabels.join('; '),
      c.sourceCount,
      c.minReport.count,
      c.minReport.sourceName,
      c.maxReport.count,
      c.maxReport.sourceName,
      c.medianCount,
      c.spread,
      c.spreadPct.toFixed(1),
      c.pubSpanDays,
      formatDateShort(c.earliestPubDate),
      formatDateShort(c.latestPubDate),
      c.statusSummary,
      breakdown,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csvContent = `\uFEFF${headers.map(escapeCsvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    filename ||
    `gaza-births-discrepancy-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
