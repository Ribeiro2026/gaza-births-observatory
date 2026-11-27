import React, { useMemo, useState } from 'react';
import { Calendar, Download, Grid3X3 } from 'lucide-react';
import { exportHeatmapToPng } from '../lib/heatmap-export';
import {
  cn,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
} from '../lib/utils';
import type {
  BirthReportRecord,
  CredibilityTier,
  SourceRecord,
} from '../types/observatory';

type HeatmapTierScope = 'ALL' | CredibilityTier;

const TIER_FILTER_OPTIONS: Array<{ value: HeatmapTierScope; label: string }> = [
  { value: 'Tier 1 - Primary Registry', label: 'Tier 1 Only' },
  { value: 'ALL', label: 'All Tiers' },
  { value: 'Tier 2 - Multilateral', label: 'Tier 2' },
  { value: 'Tier 3 - Media / Secondary', label: 'Tier 3' },
];

interface BirthHeatmapsPanelProps {
  sources: SourceRecord[];
  reports: BirthReportRecord[];
  loading: boolean;
  initialMode?: 'calendar' | 'matrix';
  embeddedInHero?: boolean;
  onInspectReport: (reportId: number) => void;
}

const MONTH_COLS = [
  { num: '01', label: 'Jan' },
  { num: '02', label: 'Feb' },
  { num: '03', label: 'Mar' },
  { num: '04', label: 'Apr' },
  { num: '05', label: 'May' },
  { num: '06', label: 'Jun' },
  { num: '07', label: 'Jul' },
  { num: '08', label: 'Aug' },
  { num: '09', label: 'Sep' },
  { num: '10', label: 'Oct' },
  { num: '11', label: 'Nov' },
  { num: '12', label: 'Dec' },
];

// Sequential Deep Lapis ramp for monthly birth volumes
function getVolumeTileColors(value: number, minVal: number, maxVal: number) {
  const span = Math.max(maxVal - minVal, 1);
  const t = Math.max(0, Math.min(1, (value - minVal) / span));
  if (t < 0.2) return { bg: '#EFF6FF', fg: '#0F172A' };
  if (t < 0.4) return { bg: '#DBEAFE', fg: '#0F172A' };
  if (t < 0.6) return { bg: '#93C5FD', fg: '#0F172A' };
  if (t < 0.8) return { bg: '#3B82F6', fg: '#FFFFFF' };
  return { bg: '#1E3A8A', fg: '#FFFFFF' };
}

// Sequential Burnt Ochre ramp for cross-source discrepancy percentage
function getDiscrepancyTileColors(pct: number) {
  if (pct < 4) return { bg: '#F8FAFC', fg: '#334155' };
  if (pct < 8) return { bg: '#FEF3C7', fg: '#0F172A' };
  if (pct < 14) return { bg: '#FDE68A', fg: '#0F172A' };
  if (pct < 20) return { bg: '#D97706', fg: '#FFFFFF' };
  return { bg: '#9A3412', fg: '#FFFFFF' };
}

// Diverging Editorial ramp for Source Deviation vs Period Median
// Positive (higher than median, e.g. UN population estimate) = Slate Teal
// Negative (lower than median, e.g. partial hospital/civil registry) = Burnt Ochre / Crimson
function getDeviationTileColors(deltaPct: number) {
  if (Math.abs(deltaPct) < 1.5) return { bg: '#F8FAFC', fg: '#334155' };
  if (deltaPct >= 10) return { bg: '#0F766E', fg: '#FFFFFF' };
  if (deltaPct >= 4) return { bg: '#5EEAD4', fg: '#0F172A' };
  if (deltaPct > 0) return { bg: '#CCFBF1', fg: '#0F172A' };
  if (deltaPct <= -10) return { bg: '#9A3412', fg: '#FFFFFF' };
  if (deltaPct <= -4) return { bg: '#FDBA74', fg: '#0F172A' };
  return { bg: '#FFEDD5', fg: '#0F172A' };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function BirthHeatmapsPanel({
  sources,
  reports,
  loading,
  initialMode = 'calendar',
  embeddedInHero = false,
  onInspectReport,
}: BirthHeatmapsPanelProps) {
  const [viewMode, setViewMode] = useState<'calendar' | 'matrix'>(initialMode);
  const [tierFilter, setTierFilter] = useState<HeatmapTierScope>('Tier 1 - Primary Registry');
  const [calendarMetric, setCalendarMetric] = useState<'volume' | 'discrepancy'>('volume');
  const [calendarSourceId, setCalendarSourceId] = useState<string>('ALL');
  const [matrixMetric, setMatrixMetric] = useState<'deviation' | 'volume'>('deviation');
  const [matrixYear, setMatrixYear] = useState<string>('2026');
  const [exporting, setExporting] = useState(false);

  const [hoveredDetail, setHoveredDetail] = useState<{
    title: string;
    subtitle: string;
    rows: Array<{ label: string; value: string; status?: string }>;
  } | null>(null);

  const scopedSources = useMemo(
    () =>
      tierFilter === 'ALL'
        ? sources
        : sources.filter((s) => s.credibilityTier === tierFilter),
    [sources, tierFilter]
  );

  // Reset selected individual source if switching tier removes it
  React.useEffect(() => {
    if (
      calendarSourceId !== 'ALL' &&
      !scopedSources.some((s) => String(s.id) === calendarSourceId)
    ) {
      setCalendarSourceId('ALL');
    }
  }, [scopedSources, calendarSourceId]);

  // Monthly active reports scoped by tier (exclude Superseded for crisp statistical heatmaps)
  const monthlyReports = useMemo(() => {
    const allowedSourceIds = new Set(scopedSources.map((s) => s.id));
    return reports.filter(
      (r) =>
        r.periodType === 'Monthly' &&
        r.confidenceStatus !== 'Superseded' &&
        allowedSourceIds.has(r.sourceId)
    );
  }, [reports, scopedSources]);

  const availableYears = useMemo(() => {
    const yrs = new Set(monthlyReports.map((r) => r.periodValue.slice(0, 4)));
    return Array.from(yrs).sort().reverse();
  }, [monthlyReports]);

  // Keep matrixYear valid if data changes
  React.useEffect(() => {
    if (
      matrixYear !== 'All' &&
      availableYears.length > 0 &&
      !availableYears.includes(matrixYear)
    ) {
      setMatrixYear(availableYears[0]);
    }
  }, [availableYears, matrixYear]);

  // 1. Calendar Heatmap Computation (Years x Jan-Dec)
  const calendarData = useMemo(() => {
    const scoped =
      calendarSourceId === 'ALL'
        ? monthlyReports
        : monthlyReports.filter((r) => r.sourceId === Number(calendarSourceId));

    const byPeriod = new Map<string, BirthReportRecord[]>();
    for (const r of scoped) {
      const list = byPeriod.get(r.periodValue) || [];
      list.push(r);
      byPeriod.set(r.periodValue, list);
    }

    const volumes: number[] = [];
    const cellMap = new Map<
      string,
      {
        periodValue: string;
        reports: BirthReportRecord[];
        medianCount: number;
        spread: number;
        spreadPct: number;
        primaryReportId: number;
      }
    >();

    for (const [periodValue, list] of byPeriod.entries()) {
      const sorted = [...list].sort((a, b) => a.count - b.count);
      const med = median(sorted.map((x) => x.count));
      const minC = sorted[0].count;
      const maxC = sorted[sorted.length - 1].count;
      const spread = maxC - minC;
      const spreadPct = minC > 0 ? (spread / minC) * 100 : 0;
      volumes.push(med);

      // Prefer MOH Gaza or first verified report when clicking a multi-source cell
      const preferred =
        list.find((r) => r.sourceName === 'MOH Gaza') ||
        list.find((r) => r.confidenceStatus === 'Verified') ||
        list[0];

      cellMap.set(periodValue, {
        periodValue,
        reports: list,
        medianCount: med,
        spread,
        spreadPct,
        primaryReportId: preferred.id,
      });
    }

    const minVol = volumes.length ? Math.min(...volumes) : 3500;
    const maxVol = volumes.length ? Math.max(...volumes) : 5600;

    return { cellMap, minVol, maxVol };
  }, [monthlyReports, calendarSourceId]);

  // 2. Source x Period Coverage & Deviation Matrix Computation
  const matrixData = useMemo(() => {
    const scoped =
      matrixYear === 'All'
        ? monthlyReports
        : monthlyReports.filter((r) => r.periodValue.startsWith(matrixYear));

    const periodSet = new Set(scoped.map((r) => r.periodValue));
    // Show up to 12 most recent periods if 'All', or all months of the selected year
    let periods = Array.from(periodSet).sort();
    if (matrixYear === 'All' && periods.length > 14) {
      periods = periods.slice(-14);
    }

    const periodMedians = new Map<string, number>();
    for (const p of periods) {
      const counts = scoped.filter((r) => r.periodValue === p).map((r) => r.count);
      periodMedians.set(p, median(counts));
    }

    const lookup = new Map<string, BirthReportRecord>();
    const allCounts: number[] = [];
    for (const r of scoped) {
      if (!periodSet.has(r.periodValue)) continue;
      const key = `${r.sourceId}:${r.periodValue}`;
      const existing = lookup.get(key);
      if (
        !existing ||
        new Date(r.publicationDate).getTime() > new Date(existing.publicationDate).getTime()
      ) {
        lookup.set(key, r);
      }
      allCounts.push(r.count);
    }

    const activeSources = scopedSources.filter((s) =>
      periods.some((p) => lookup.has(`${s.id}:${p}`))
    );

    const minVol = allCounts.length ? Math.min(...allCounts) : 3500;
    const maxVol = allCounts.length ? Math.max(...allCounts) : 5600;

    return { periods, periodMedians, lookup, activeSources, minVol, maxVol };
  }, [monthlyReports, scopedSources, matrixYear]);

  const handleExportPng = async () => {
    setExporting(true);
    try {
      if (viewMode === 'calendar') {
        const sourceName =
          calendarSourceId === 'ALL'
            ? 'All Active Sources (Median)'
            : sources.find((s) => s.id === Number(calendarSourceId))?.name || 'Source';

        const grid = availableYears.map((yr) =>
          MONTH_COLS.map((m) => {
            const cell = calendarData.cellMap.get(`${yr}-${m.num}`);
            if (!cell) {
              return { text: '—', bg: '#FAFAFA', fg: '#94A3B8' };
            }
            if (calendarMetric === 'volume') {
              const colors = getVolumeTileColors(
                cell.medianCount,
                calendarData.minVol,
                calendarData.maxVol
              );
              return {
                text: formatNumber(cell.medianCount),
                subtext: `${cell.reports.length} src`,
                bg: colors.bg,
                fg: colors.fg,
              };
            }
            if (cell.reports.length < 2) {
              return { text: '1 src', bg: '#F8FAFC', fg: '#94A3B8' };
            }
            const colors = getDiscrepancyTileColors(cell.spreadPct);
            return {
              text: `${cell.spreadPct.toFixed(1)}%`,
              subtext: `±${formatNumber(cell.spread)}`,
              bg: colors.bg,
              fg: colors.fg,
            };
          })
        );

        await exportHeatmapToPng({
          title:
            calendarMetric === 'volume'
              ? 'Gaza Monthly Birth Volume — Calendar Heatmap'
              : 'Gaza Birth Reports — Cross-Source Discrepancy Heatmap',
          subtitle:
            calendarMetric === 'volume'
              ? 'Year-by-month intensity view of reported live births (excluding superseded figures)'
              : 'Percentage divergence between lowest and highest reporting source each month',
          activeFiltersLabel: `Calendar Heatmap · Tier: ${
            tierFilter === 'ALL' ? 'All Tiers' : tierFilter
          } · Source: ${sourceName} · Metric: ${
            calendarMetric === 'volume' ? 'Monthly Volume' : 'Cross-Source Spread %'
          }`,
          rowLabels: availableYears,
          colLabels: MONTH_COLS.map((m) => m.label),
          grid,
          legendLabel:
            calendarMetric === 'volume' ? 'Births / Month:' : 'Source Spread:',
          legendSwatches:
            calendarMetric === 'volume'
              ? [
                  { color: '#EFF6FF', label: formatNumber(calendarData.minVol) },
                  {
                    color: '#93C5FD',
                    label: formatNumber(
                      Math.round((calendarData.minVol + calendarData.maxVol) / 2)
                    ),
                  },
                  { color: '#1E3A8A', label: formatNumber(calendarData.maxVol) },
                ]
              : [
                  { color: '#F8FAFC', label: '<4%' },
                  { color: '#FDE68A', label: '8–14%' },
                  { color: '#D97706', label: '14–20%' },
                  { color: '#9A3412', label: '>20%' },
                ],
          filename: `gaza-births-calendar-heatmap-${new Date().toISOString().slice(0, 10)}.png`,
        });
      } else {
        const grid = matrixData.activeSources.map((src) =>
          matrixData.periods.map((p) => {
            const report = matrixData.lookup.get(`${src.id}:${p}`);
            if (!report) {
              return { text: '—', bg: '#FAFAFA', fg: '#94A3B8' };
            }
            if (matrixMetric === 'volume') {
              const colors = getVolumeTileColors(
                report.count,
                matrixData.minVol,
                matrixData.maxVol
              );
              return {
                text: formatNumber(report.count),
                bg: colors.bg,
                fg: colors.fg,
              };
            }
            const med = matrixData.periodMedians.get(p) || report.count;
            const deltaPct = med > 0 ? ((report.count - med) / med) * 100 : 0;
            const colors = getDeviationTileColors(deltaPct);
            const sign = deltaPct > 0 ? '+' : '';
            return {
              text: `${sign}${deltaPct.toFixed(1)}%`,
              subtext: formatNumber(report.count),
              bg: colors.bg,
              fg: colors.fg,
            };
          })
        );

        await exportHeatmapToPng({
          title: 'Source Coverage & Consensus Deviation Matrix',
          subtitle:
            matrixMetric === 'deviation'
              ? 'How each publisher deviates above or below the multi-source monthly median'
              : 'Monthly reported live births plotted by publishing registry and agency',
          activeFiltersLabel: `Source Matrix · Tier: ${
            tierFilter === 'ALL' ? 'All Tiers' : tierFilter
          } · Scope: ${
            matrixYear === 'All' ? 'Recent 14 Months' : `Year ${matrixYear}`
          } · Metric: ${matrixMetric === 'deviation' ? 'Consensus Deviation %' : 'Absolute Volume'}`,
          rowLabels: matrixData.activeSources.map((s) => s.name),
          colLabels: matrixData.periods.map((p) =>
            matrixYear === 'All' ? formatPeriodLabel(p) : formatPeriodLabel(p).slice(0, 3)
          ),
          grid,
          legendLabel:
            matrixMetric === 'deviation' ? 'vs. Period Median:' : 'Births / Month:',
          legendSwatches:
            matrixMetric === 'deviation'
              ? [
                  { color: '#9A3412', label: '≤ -10%' },
                  { color: '#FDBA74', label: '-4% to -10%' },
                  { color: '#F8FAFC', label: 'Aligned' },
                  { color: '#5EEAD4', label: '+4% to +10%' },
                  { color: '#0F766E', label: '≥ +10%' },
                ]
              : [
                  { color: '#EFF6FF', label: formatNumber(matrixData.minVol) },
                  {
                    color: '#93C5FD',
                    label: formatNumber(
                      Math.round((matrixData.minVol + matrixData.maxVol) / 2)
                    ),
                  },
                  { color: '#1E3A8A', label: formatNumber(matrixData.maxVol) },
                ],
          filename: `gaza-births-source-heatmap-${new Date().toISOString().slice(0, 10)}.png`,
        });
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <section
      className={cn(
        !embeddedInHero && 'rounded-lg border border-[#E2E8F0] bg-white'
      )}
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          {!embeddedInHero && (
            <div className="mr-2">
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                Demographic Intensity & Discrepancy Heatmaps
              </h2>
              <p className="text-xs text-[#64748B]">
                Inspect seasonal trends, agency reporting gaps, and consensus deviations across
                2023–2026
              </p>
            </div>
          )}

          {/* Calendar vs Source Matrix Switch */}
          <div
            className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
            role="group"
            aria-label="Heatmap layout"
          >
            <button
              type="button"
              onClick={() => {
                setViewMode('calendar');
                setHoveredDetail(null);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                viewMode === 'calendar'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              Year × Month Calendar
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('matrix');
                setHoveredDetail(null);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                viewMode === 'matrix'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              )}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              Source × Period Matrix
            </button>
          </div>
        </div>

        {/* Right-side tier, metric & scope selectors + PNG Export */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Credibility Tier Filter (Defaults to Tier 1 Only) */}
          <div
            className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
            role="group"
            aria-label="Heatmap credibility tier"
          >
            {TIER_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTierFilter(opt.value);
                  setHoveredDetail(null);
                }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  tierFilter === opt.value
                    ? 'bg-white text-[#1E3A8A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {viewMode === 'calendar' ? (
            <>
              <div className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5">
                <button
                  type="button"
                  onClick={() => setCalendarMetric('volume')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    calendarMetric === 'volume'
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  Birth Volume
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCalendarMetric('discrepancy');
                    setCalendarSourceId('ALL');
                  }}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    calendarMetric === 'discrepancy'
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  Discrepancy %
                </button>
              </div>

              {calendarMetric === 'volume' && (
                <select
                  aria-label="Heatmap source filter"
                  value={calendarSourceId}
                  onChange={(e) => setCalendarSourceId(e.target.value)}
                  className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A]"
                >
                  <option value="ALL">
                    {tierFilter === 'ALL' ? 'All Sources (Median)' : 'Tier Median'}
                  </option>
                  {scopedSources.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : (
            <>
              <div className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5">
                <button
                  type="button"
                  onClick={() => setMatrixMetric('deviation')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    matrixMetric === 'deviation'
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  Consensus Deviation
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixMetric('volume')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    matrixMetric === 'volume'
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  Absolute Count
                </button>
              </div>

              <select
                aria-label="Matrix year scope"
                value={matrixYear}
                onChange={(e) => setMatrixYear(e.target.value)}
                className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A]"
              >
                <option value="All">Recent 14 Months</option>
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    Year {yr}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={handleExportPng}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#1E3A8A]" />
            {exporting ? 'Exporting...' : 'Export Heatmap'}
          </button>
        </div>
      </div>

      {/* Color Scale Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] bg-[#FAFAFA] px-5 py-2.5 text-[11px] text-[#475569]">
        {viewMode === 'calendar' && calendarMetric === 'volume' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-[#334155]">Monthly Births Scale:</span>
            <span className="font-mono tabular-nums text-[#64748B]">
              {formatNumber(calendarData.minVol)}
            </span>
            <div className="flex items-center gap-0.5">
              {['#EFF6FF', '#DBEAFE', '#93C5FD', '#3B82F6', '#1E3A8A'].map((c) => (
                <span
                  key={c}
                  className="h-3 w-6 border border-[#CBD5E1]/70"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="font-mono tabular-nums text-[#64748B]">
              {formatNumber(calendarData.maxVol)}
            </span>
          </div>
        )}

        {viewMode === 'calendar' && calendarMetric === 'discrepancy' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-[#334155]">Cross-Source Spread (%):</span>
            <span className="font-mono text-[#64748B]">&lt;4%</span>
            <div className="flex items-center gap-0.5">
              {['#F8FAFC', '#FEF3C7', '#FDE68A', '#D97706', '#9A3412'].map((c) => (
                <span
                  key={c}
                  className="h-3 w-6 border border-[#CBD5E1]/70"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="font-mono text-[#64748B]">&gt;20%</span>
          </div>
        )}

        {viewMode === 'matrix' && matrixMetric === 'deviation' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-[#334155]">Deviation vs. Period Median:</span>
            <span className="font-mono text-[#9A3412]">Lower (≤ -10%)</span>
            <div className="flex items-center gap-0.5">
              {[
                '#9A3412',
                '#FDBA74',
                '#FFEDD5',
                '#F8FAFC',
                '#CCFBF1',
                '#5EEAD4',
                '#0F766E',
              ].map((c) => (
                <span
                  key={c}
                  className="h-3 w-5 border border-[#CBD5E1]/70"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="font-mono text-[#0F766E]">Higher (≥ +10%)</span>
          </div>
        )}

        {viewMode === 'matrix' && matrixMetric === 'volume' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-[#334155]">Reported Births Scale:</span>
            <span className="font-mono tabular-nums text-[#64748B]">
              {formatNumber(matrixData.minVol)}
            </span>
            <div className="flex items-center gap-0.5">
              {['#EFF6FF', '#DBEAFE', '#93C5FD', '#3B82F6', '#1E3A8A'].map((c) => (
                <span
                  key={c}
                  className="h-3 w-6 border border-[#CBD5E1]/70"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="font-mono tabular-nums text-[#64748B]">
              {formatNumber(matrixData.maxVol)}
            </span>
          </div>
        )}

        <span className="text-[#64748B]">Click any cell to open full citation & revision diff</span>
      </div>

      {/* Heatmap Matrix Body */}
      <div className="p-5">
        {loading ? (
          <div className="h-[240px] w-full animate-pulse rounded bg-[#F8FAFC]" />
        ) : viewMode === 'calendar' ? (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {/* Column Headers */}
              <div className="grid grid-cols-[72px_repeat(12,minmax(0,1fr))] gap-1.5 pb-2 text-center font-mono text-[11px] font-medium text-[#475569]">
                <div className="text-left text-[#64748B]">Year</div>
                {MONTH_COLS.map((m) => (
                  <div key={m.num}>{m.label}</div>
                ))}
              </div>

              {/* Year Rows */}
              <div className="space-y-1.5">
                {availableYears.map((yr) => (
                  <div
                    key={yr}
                    className="grid grid-cols-[72px_repeat(12,minmax(0,1fr))] items-center gap-1.5"
                  >
                    <div className="font-mono text-xs font-semibold text-[#0F172A]">{yr}</div>
                    {MONTH_COLS.map((m) => {
                      const periodKey = `${yr}-${m.num}`;
                      const cell = calendarData.cellMap.get(periodKey);

                      if (!cell) {
                        return (
                          <div
                            key={periodKey}
                            className="flex h-12 items-center justify-center rounded-[3px] border border-dashed border-[#E2E8F0] bg-[#FAFAFA] font-mono text-[11px] text-[#CBD5E1]"
                            title={`No active reports for ${m.label} ${yr}`}
                          >
                            —
                          </div>
                        );
                      }

                      const isDiscrepancyMode = calendarMetric === 'discrepancy';
                      const hasSpread = cell.reports.length >= 2;
                      const colors = isDiscrepancyMode
                        ? hasSpread
                          ? getDiscrepancyTileColors(cell.spreadPct)
                          : { bg: '#F8FAFC', fg: '#94A3B8' }
                        : getVolumeTileColors(
                            cell.medianCount,
                            calendarData.minVol,
                            calendarData.maxVol
                          );

                      return (
                        <button
                          key={periodKey}
                          type="button"
                          onClick={() => onInspectReport(cell.primaryReportId)}
                          onMouseEnter={() =>
                            setHoveredDetail({
                              title: `${m.label} ${yr}`,
                              subtitle:
                                cell.reports.length >= 2
                                  ? `Median ${formatNumber(cell.medianCount)} · Spread ±${formatNumber(
                                      cell.spread
                                    )} (${cell.spreadPct.toFixed(1)}%)`
                                  : `Single reporting source (${formatNumber(cell.medianCount)} births)`,
                              rows: cell.reports
                                .slice()
                                .sort((a, b) => b.count - a.count)
                                .map((r) => ({
                                  label: r.sourceName,
                                  value: formatNumber(r.count),
                                  status: r.confidenceStatus,
                                })),
                            })
                          }
                          onMouseLeave={() => setHoveredDetail(null)}
                          style={{ backgroundColor: colors.bg, color: colors.fg }}
                          className="group flex h-12 flex-col items-center justify-center rounded-[3px] border border-black/5 px-1 transition-transform duration-150 hover:scale-[1.03] hover:ring-2 hover:ring-[#1E3A8A]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A] cursor-pointer"
                        >
                          <span className="font-mono text-[11px] font-semibold tabular-nums leading-tight">
                            {isDiscrepancyMode
                              ? hasSpread
                                ? `${cell.spreadPct.toFixed(0)}%`
                                : '1 src'
                              : formatNumber(cell.medianCount)}
                          </span>
                          <span className="mt-0.5 font-mono text-[9.5px] opacity-80 tabular-nums leading-none">
                            {isDiscrepancyMode
                              ? hasSpread
                                ? `±${formatNumber(cell.spread)}`
                                : formatNumber(cell.medianCount)
                              : `${cell.reports.length} ${cell.reports.length === 1 ? 'src' : 'srcs'}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {/* Source x Period Header */}
              <div
                className="grid gap-1.5 pb-2 font-mono text-[11px] font-medium text-[#475569]"
                style={{
                  gridTemplateColumns: `168px repeat(${Math.max(matrixData.periods.length, 1)}, minmax(0, 1fr))`,
                }}
              >
                <div className="text-left font-sans text-[#64748B]">Publishing Source</div>
                {matrixData.periods.map((p) => (
                  <div key={p} className="text-center">
                    {matrixYear === 'All'
                      ? formatPeriodLabel(p).replace(' 20', " '")
                      : formatPeriodLabel(p).slice(0, 3)}
                  </div>
                ))}
              </div>

              {/* Source Rows */}
              <div className="space-y-1.5">
                {matrixData.activeSources.map((src) => (
                  <div
                    key={src.id}
                    className="grid items-center gap-1.5"
                    style={{
                      gridTemplateColumns: `168px repeat(${Math.max(matrixData.periods.length, 1)}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="flex items-center gap-2 pr-2 truncate">
                      <span
                        className="h-[3px] w-3 shrink-0"
                        style={{ backgroundColor: src.seriesColor }}
                      />
                      <span className="truncate text-xs font-medium text-[#0F172A]">
                        {src.name}
                      </span>
                    </div>

                    {matrixData.periods.map((p) => {
                      const report = matrixData.lookup.get(`${src.id}:${p}`);
                      if (!report) {
                        return (
                          <div
                            key={p}
                            className="flex h-12 items-center justify-center rounded-[3px] border border-dashed border-[#E2E8F0] bg-[#FAFAFA] font-mono text-[11px] text-[#CBD5E1]"
                            title={`No ${src.name} bulletin logged for ${formatPeriodLabel(p)}`}
                          >
                            —
                          </div>
                        );
                      }

                      const periodMed = matrixData.periodMedians.get(p) || report.count;
                      const delta = report.count - periodMed;
                      const deltaPct = periodMed > 0 ? (delta / periodMed) * 100 : 0;

                      const colors =
                        matrixMetric === 'deviation'
                          ? getDeviationTileColors(deltaPct)
                          : getVolumeTileColors(
                              report.count,
                              matrixData.minVol,
                              matrixData.maxVol
                            );

                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => onInspectReport(report.id)}
                          onMouseEnter={() =>
                            setHoveredDetail({
                              title: `${src.name} · ${formatPeriodLabel(p)}`,
                              subtitle: `Ref: ${report.documentRef} · Consensus median: ${formatNumber(
                                periodMed
                              )}`,
                              rows: [
                                {
                                  label: 'Reported Births',
                                  value: formatNumber(report.count),
                                  status: report.confidenceStatus,
                                },
                                {
                                  label: 'vs. Period Median',
                                  value: `${delta >= 0 ? '+' : ''}${formatNumber(delta)} (${
                                    deltaPct >= 0 ? '+' : ''
                                  }${deltaPct.toFixed(1)}%)`,
                                },
                              ],
                            })
                          }
                          onMouseLeave={() => setHoveredDetail(null)}
                          style={{ backgroundColor: colors.bg, color: colors.fg }}
                          className="flex h-12 flex-col items-center justify-center rounded-[3px] border border-black/5 px-1 transition-transform duration-150 hover:scale-[1.03] hover:ring-2 hover:ring-[#1E3A8A]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A] cursor-pointer"
                        >
                          <span className="font-mono text-[11px] font-semibold tabular-nums leading-tight">
                            {matrixMetric === 'deviation'
                              ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
                              : formatNumber(report.count)}
                          </span>
                          <span className="mt-0.5 font-mono text-[9.5px] opacity-80 tabular-nums leading-none">
                            {matrixMetric === 'deviation'
                              ? formatNumber(report.count)
                              : report.confidenceStatus === 'Verified'
                                ? 'Verified'
                                : report.confidenceStatus}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Live Cell Detail Bar (Zero layout shift fixed-height inspection strip) */}
        <div className="mt-4 flex min-h-[46px] flex-wrap items-center justify-between gap-3 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] px-4 py-2.5 text-xs">
          {hoveredDetail ? (
            <>
              <div>
                <span className="font-serif font-semibold text-[#0F172A]">
                  {hoveredDetail.title}
                </span>
                <span className="mx-2 text-[#CBD5E1]">·</span>
                <span className="text-[#475569]">{hoveredDetail.subtitle}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {hoveredDetail.rows.map((row) => (
                  <span key={row.label} className="inline-flex items-center gap-1.5">
                    <span className="text-[#64748B]">{row.label}:</span>
                    <span className="font-mono font-semibold tabular-nums text-[#0F172A]">
                      {row.value}
                    </span>
                    {row.status && (
                      <span
                        className={cn(
                          'text-[10px] font-medium',
                          getStatusTextClass(row.status as BirthReportRecord['confidenceStatus'])
                        )}
                      >
                        {row.status}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="text-[#64748B]">
              Hover any colored tile to inspect source-by-source values and period median spreads, or
              click a tile to open its archived quote and revision log.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
