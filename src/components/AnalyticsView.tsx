import React, { useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRight,
  BarChart3,
  Download,
  History,
  LineChart as LineChartIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { exportChartToPng } from '../lib/chart-export';
import {
  cn,
  formatDateShort,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
} from '../lib/utils';
import type {
  BirthReportRecord,
  PeriodType,
  RevisionLogRecord,
  SourceRecord,
} from '../types/observatory';
import { BirthHeatmapsPanel } from './BirthHeatmapsPanel';

interface AnalyticsViewProps {
  sources: SourceRecord[];
  reports: BirthReportRecord[];
  revisions: RevisionLogRecord[];
  pendingStagingCount: number;
  isOwner: boolean;
  loading: boolean;
  onInspectReport: (reportId: number) => void;
  onNavigateTab: (
    tab: 'analytics' | 'heatmaps' | 'discrepancies' | 'explorer' | 'ingestion' | 'sources'
  ) => void;
}

type ConfidenceScope = 'verified' | 'active' | 'all';

interface ChartPeriodRow {
  periodValue: string;
  label: string;
  [key: string]: string | number | undefined;
}

export function AnalyticsView({
  sources,
  reports,
  revisions,
  pendingStagingCount,
  isOwner,
  loading,
  onInspectReport,
  onNavigateTab,
}: AnalyticsViewProps) {
  const [periodType, setPeriodType] = useState<PeriodType>('Monthly');
  const [chartMode, setChartMode] = useState<'line' | 'bar'>('line');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [confidenceScope, setConfidenceScope] = useState<ConfidenceScope>('active');
  const [hiddenSourceIds, setHiddenSourceIds] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const r of reports) {
      yrs.add(r.periodValue.slice(0, 4));
    }
    return Array.from(yrs).sort().reverse();
  }, [reports]);

  const activeSources = useMemo(
    () => sources.filter((s) => !hiddenSourceIds.includes(s.id)),
    [sources, hiddenSourceIds]
  );

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (r.periodType !== periodType) return false;
      if (yearFilter !== 'All' && !r.periodValue.startsWith(yearFilter)) return false;
      if (hiddenSourceIds.includes(r.sourceId)) return false;
      if (confidenceScope === 'verified' && r.confidenceStatus !== 'Verified') {
        return false;
      }
      if (confidenceScope === 'active' && r.confidenceStatus === 'Superseded') {
        return false;
      }
      return true;
    });
  }, [reports, periodType, yearFilter, hiddenSourceIds, confidenceScope]);

  // Build chart data keyed by periodValue with sourceId columns + lookup map for click-to-inspect
  const { chartData, cellReportMap, periodDiscrepancies } = useMemo(() => {
    const byPeriod = new Map<string, BirthReportRecord[]>();
    for (const r of filteredReports) {
      const list = byPeriod.get(r.periodValue) || [];
      list.push(r);
      byPeriod.set(r.periodValue, list);
    }

    const sortedPeriods = Array.from(byPeriod.keys()).sort();
    const lookup = new Map<string, BirthReportRecord>();
    const rows: ChartPeriodRow[] = [];
    const discrepancies: Array<{
      periodValue: string;
      label: string;
      minReport: BirthReportRecord;
      maxReport: BirthReportRecord;
      spread: number;
      spreadPct: number;
      sourceCount: number;
    }> = [];

    for (const periodValue of sortedPeriods) {
      const list = byPeriod.get(periodValue) || [];
      const row: ChartPeriodRow = {
        periodValue,
        label: formatPeriodLabel(periodValue),
      };

      for (const r of list) {
        const key = `s_${r.sourceId}`;
        // If multiple reports exist for the same source/period, keep the most recent publication
        const existing = lookup.get(`${periodValue}:${r.sourceId}`);
        if (
          !existing ||
          new Date(r.publicationDate).getTime() > new Date(existing.publicationDate).getTime()
        ) {
          row[key] = r.count;
          lookup.set(`${periodValue}:${r.sourceId}`, r);
        }
      }

      rows.push(row);

      if (list.length >= 2) {
        const sortedByCount = [...list].sort((a, b) => a.count - b.count);
        const minReport = sortedByCount[0];
        const maxReport = sortedByCount[sortedByCount.length - 1];
        const spread = maxReport.count - minReport.count;
        const spreadPct = minReport.count > 0 ? (spread / minReport.count) * 100 : 0;
        discrepancies.push({
          periodValue,
          label: formatPeriodLabel(periodValue),
          minReport,
          maxReport,
          spread,
          spreadPct,
          sourceCount: list.length,
        });
      }
    }

    discrepancies.sort((a, b) => b.periodValue.localeCompare(a.periodValue));

    return { chartData: rows, cellReportMap: lookup, periodDiscrepancies: discrepancies };
  }, [filteredReports]);

  // Determine which sources actually have points in the active chart view
  const plottedSources = useMemo(() => {
    const present = new Set(filteredReports.map((r) => r.sourceId));
    return activeSources.filter((s) => present.has(s.id));
  }, [activeSources, filteredReports]);

  // Summary metrics
  const metrics = useMemo(() => {
    const latestVerified = filteredReports
      .filter((r) => r.confidenceStatus === 'Verified')
      .sort((a, b) => b.periodValue.localeCompare(a.periodValue))[0];

    const widestDiscrepancy = [...periodDiscrepancies].sort((a, b) => b.spread - a.spread)[0];

    const verifiedTotal = reports.filter((r) => r.confidenceStatus === 'Verified').length;
    const verifiedPct = reports.length > 0 ? Math.round((verifiedTotal / reports.length) * 100) : 0;

    return {
      latestVerified,
      widestDiscrepancy,
      totalActiveReports: filteredReports.length,
      totalRevisions: revisions.length,
      verifiedTotal,
      verifiedPct,
    };
  }, [filteredReports, periodDiscrepancies, reports, revisions.length]);

  const toggleSource = (sourceId: number) => {
    setHiddenSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const handleExportPng = async () => {
    if (!chartContainerRef.current) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const scopeLabel =
        confidenceScope === 'verified'
          ? 'Verified Only'
          : confidenceScope === 'active'
            ? 'Verified, Pending & Disputed'
            : 'All (incl. Superseded)';
      const filterDesc = `${periodType} · Year: ${yearFilter} · Scope: ${scopeLabel} · ${plottedSources.length} sources`;

      await exportChartToPng({
        containerEl: chartContainerRef.current,
        title: `Gaza Birth Statistics — ${periodType} Multi-Source Comparison`,
        subtitle:
          'Reported live births and humanitarian estimates plotted by publishing registry and agency',
        activeFiltersLabel: filterDesc,
        legendItems: plottedSources.map((s) => ({ label: s.name, color: s.seriesColor })),
        filename: `gaza-births-${periodType.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.png`,
      });
      setExportMessage('Exported high-resolution PNG with provenance watermark.');
      setTimeout(() => setExportMessage(null), 4000);
    } catch (err: unknown) {
      setExportMessage(err instanceof Error ? err.message : 'Chart PNG export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleChartPointClick = (periodValue: string, preferredSourceId?: number) => {
    if (preferredSourceId) {
      const exact = cellReportMap.get(`${periodValue}:${preferredSourceId}`);
      if (exact) {
        onInspectReport(exact.id);
        return;
      }
    }
    for (const s of plottedSources) {
      const match = cellReportMap.get(`${periodValue}:${s.id}`);
      if (match) {
        onInspectReport(match.id);
        return;
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Editorial Section Intro */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Multi-Source Demographic Reconciliation
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
            Compare reported monthly and annual Gaza birth figures across hospital registries, civil
            status ledgers, UN agencies, and media briefings. Select any plotted figure to inspect
            its verbatim quote and revision history.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleExportPng}
            disabled={exporting || chartData.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#1E3A8A]" />
            {exporting ? 'Rendering PNG...' : 'Export PNG'}
          </button>
        </div>
      </div>

      {exportMessage && (
        <div className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2.5 text-xs text-[#334155]">
          {exportMessage}
        </div>
      )}

      {/* Primary Focal Chart Container (Single-Elevation White Surface) */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        {/* Chart Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            {/* Monthly / Yearly Toggle */}
            <div
              className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
              role="group"
              aria-label="Aggregation period"
            >
              {(['Monthly', 'Yearly'] as PeriodType[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeriodType(mode)}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    periodType === mode
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Line / Grouped Bar Toggle */}
            <div
              className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
              role="group"
              aria-label="Chart visualization mode"
            >
              <button
                type="button"
                onClick={() => setChartMode('line')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  chartMode === 'line'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                <LineChartIcon className="h-3.5 w-3.5" />
                Trend Overlay
              </button>
              <button
                type="button"
                onClick={() => setChartMode('bar')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  chartMode === 'bar'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Grouped Bars
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Year Selector */}
            <label className="inline-flex items-center gap-2 text-xs text-[#475569]">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#64748B]" />
              <span className="whitespace-nowrap">Year</span>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
              >
                <option value="All">All Years</option>
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </label>

            {/* Confidence Scope */}
            <label className="inline-flex items-center gap-2 text-xs text-[#475569]">
              <span className="whitespace-nowrap">Status</span>
              <select
                value={confidenceScope}
                onChange={(e) => setConfidenceScope(e.target.value as ConfidenceScope)}
                className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
              >
                <option value="active">Active (Verified, Disputed, Pending)</option>
                <option value="verified">Verified Only</option>
                <option value="all">Include Superseded Preliminary</option>
              </select>
            </label>
          </div>
        </div>

        {/* Source Series Filter Bar (Clean Editorial Toggles — No Pill Boxes) */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#F1F5F9] bg-[#FAFAFA] px-5 py-2.5">
          <span className="text-xs font-medium text-[#64748B]">Active Sources:</span>
          {sources.map((src) => {
            const isActive = !hiddenSourceIds.includes(src.id);
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => toggleSource(src.id)}
                className={cn(
                  'inline-flex items-center gap-2 py-0.5 text-xs font-medium transition-opacity whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:underline',
                  isActive ? 'text-[#0F172A] opacity-100' : 'text-[#94A3B8] opacity-55 line-through'
                )}
              >
                <span
                  className="inline-block h-[3px] w-3.5 shrink-0"
                  style={{ backgroundColor: src.seriesColor }}
                />
                <span>{src.name}</span>
              </button>
            );
          })}
        </div>

        {/* Recharts Visualization Canvas */}
        <div ref={chartContainerRef} className="p-5">
          {loading ? (
            <div className="h-[380px] w-full animate-pulse rounded bg-[#F8FAFC]" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[360px] flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-[#0F172A]">
                No birth statistics match the current chart filters.
              </p>
              <p className="mt-1 text-xs text-[#64748B]">
                Enable additional sources or widen the year and verification status filter.
              </p>
              <button
                type="button"
                onClick={() => {
                  setYearFilter('All');
                  setConfidenceScope('all');
                  setHiddenSourceIds([]);
                }}
                className="mt-4 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
              >
                Reset Chart Filters
              </button>
            </div>
          ) : (
            <div className="h-[380px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'line' ? (
                  <LineChart
                    data={chartData}
                    margin={{ top: 14, right: 20, left: 10, bottom: 8 }}
                    onClick={(state) => {
                      const idx =
                        typeof state?.activeTooltipIndex === 'number'
                          ? state.activeTooltipIndex
                          : -1;
                      const byIndex = idx >= 0 ? chartData[idx] : undefined;
                      const byLabel = state?.activeLabel
                        ? chartData.find((row) => row.label === String(state.activeLabel))
                        : undefined;
                      const target = byIndex || byLabel;
                      if (target?.periodValue) {
                        handleChartPointClick(target.periodValue);
                      }
                    }}
                  >
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#475569', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                      axisLine={{ stroke: '#CBD5E1' }}
                      tickLine={false}
                      dy={8}
                    />
                    <YAxis
                      tickFormatter={(v) => formatNumber(Number(v))}
                      tick={{ fill: '#475569', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                      axisLine={false}
                      tickLine={false}
                      width={66}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const periodVal = String(payload[0]?.payload?.periodValue || '');
                        const vals = payload
                          .map((p) => Number(p.value))
                          .filter((n) => Number.isFinite(n));
                        const spread =
                          vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;

                        return (
                          <div className="min-w-[230px] rounded-md border border-[#CBD5E1] bg-white p-3.5 shadow-sm">
                            <div className="flex items-baseline justify-between border-b border-[#E2E8F0] pb-2">
                              <span className="font-serif text-sm font-semibold text-[#0F172A]">
                                {label}
                              </span>
                              <span className="font-mono text-[11px] text-[#64748B]">
                                {periodVal}
                              </span>
                            </div>
                            <div className="mt-2.5 space-y-1.5">
                              {payload.map((entry) => {
                                const srcId = Number(String(entry.dataKey).replace('s_', ''));
                                const report = cellReportMap.get(`${periodVal}:${srcId}`);
                                return (
                                  <div
                                    key={String(entry.dataKey)}
                                    className="flex items-center justify-between gap-4 text-xs"
                                  >
                                    <div className="flex items-center gap-2 truncate">
                                      <span
                                        className="h-[3px] w-3 shrink-0"
                                        style={{ backgroundColor: entry.color }}
                                      />
                                      <span className="truncate text-[#334155]">{entry.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="font-mono font-semibold tabular-nums text-[#0F172A]">
                                        {formatNumber(Number(entry.value))}
                                      </span>
                                      {report && (
                                        <span
                                          className={cn(
                                            'text-[10px] font-medium',
                                            getStatusTextClass(report.confidenceStatus)
                                          )}
                                        >
                                          {report.confidenceStatus}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {spread !== null && (
                              <div className="mt-2.5 flex items-center justify-between border-t border-[#F1F5F9] pt-2 text-[11px] text-[#475569]">
                                <span>Cross-source spread</span>
                                <span className="font-mono font-medium tabular-nums text-[#B45309]">
                                  ±{formatNumber(spread)} births
                                </span>
                              </div>
                            )}
                            <p className="mt-2 text-[10px] text-[#64748B]">
                              Click point to inspect citation & revision log
                            </p>
                          </div>
                        );
                      }}
                    />
                    {plottedSources.map((src) => (
                      <Line
                        key={src.id}
                        type="monotone"
                        dataKey={`s_${src.id}`}
                        name={src.name}
                        stroke={src.seriesColor}
                        strokeWidth={2.2}
                        connectNulls
                        dot={{
                          r: 3.5,
                          fill: '#FFFFFF',
                          stroke: src.seriesColor,
                          strokeWidth: 2,
                        }}
                        activeDot={{
                          r: 5.5,
                          fill: src.seriesColor,
                          stroke: '#FFFFFF',
                          strokeWidth: 2,
                          onClick: (_e, payload) => {
                            const row = (payload as unknown as { payload?: ChartPeriodRow })
                              ?.payload;
                            if (row?.periodValue) {
                              handleChartPointClick(row.periodValue, src.id);
                            }
                          },
                        }}
                      />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart
                    data={chartData}
                    margin={{ top: 14, right: 20, left: 10, bottom: 8 }}
                    barGap={3}
                  >
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#475569', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                      axisLine={{ stroke: '#CBD5E1' }}
                      tickLine={false}
                      dy={8}
                    />
                    <YAxis
                      tickFormatter={(v) => formatNumber(Number(v))}
                      tick={{ fill: '#475569', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                      axisLine={false}
                      tickLine={false}
                      width={66}
                    />
                    <Tooltip
                      cursor={{ fill: '#F1F5F9', opacity: 0.7 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const periodVal = String(payload[0]?.payload?.periodValue || '');
                        return (
                          <div className="min-w-[220px] rounded-md border border-[#CBD5E1] bg-white p-3.5 shadow-sm">
                            <div className="border-b border-[#E2E8F0] pb-2 font-serif text-sm font-semibold text-[#0F172A]">
                              {label}
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {payload.map((entry) => (
                                <div
                                  key={String(entry.dataKey)}
                                  className="flex items-center justify-between gap-4 text-xs"
                                >
                                  <span className="flex items-center gap-2 text-[#334155]">
                                    <span
                                      className="h-2.5 w-2.5 shrink-0"
                                      style={{ backgroundColor: entry.color }}
                                    />
                                    {entry.name}
                                  </span>
                                  <span className="font-mono font-semibold tabular-nums text-[#0F172A]">
                                    {formatNumber(Number(entry.value))}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px] text-[#64748B]">
                              Click any bar to inspect source quote ({periodVal})
                            </p>
                          </div>
                        );
                      }}
                    />
                    {plottedSources.map((src) => (
                      <Bar
                        key={src.id}
                        dataKey={`s_${src.id}`}
                        name={src.name}
                        fill={src.seriesColor}
                        radius={[2, 2, 0, 0]}
                        maxBarSize={28}
                        className="cursor-pointer"
                        onClick={(barData) => {
                          const periodVal = barData?.payload?.periodValue as string | undefined;
                          if (periodVal) handleChartPointClick(periodVal, src.id);
                        }}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {/* Chart Footnote */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-3 text-xs text-[#64748B]">
            <span>
              Divergences reflect methodological scope: hospital delivery logs (MOH), civil
              registration certificates (MOI), and population-level humanitarian estimates (UN
              OCHA / UNFPA).
            </span>
            <span className="font-mono tabular-nums">
              {filteredReports.length} plotted observations
            </span>
          </div>
        </div>
      </section>

      {/* Full-Width 4-Column Comparative Summary Strip */}
      <section className="grid grid-cols-1 divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="text-xs font-medium text-[#64748B]">Latest Verified ({periodType})</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#0F172A]">
            {metrics.latestVerified ? formatNumber(metrics.latestVerified.count) : '—'}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            {metrics.latestVerified ? (
              <>
                {formatPeriodLabel(metrics.latestVerified.periodValue)} ·{' '}
                {metrics.latestVerified.sourceName}
              </>
            ) : (
              'No verified report in scope'
            )}
          </div>
        </div>

        <div className="p-5 sm:border-l sm:border-[#E2E8F0] lg:border-l-0">
          <div className="text-xs font-medium text-[#64748B]">Widest Source Discrepancy</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#B45309]">
            {metrics.widestDiscrepancy
              ? `±${formatNumber(metrics.widestDiscrepancy.spread)}`
              : '—'}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            {metrics.widestDiscrepancy ? (
              <>
                {metrics.widestDiscrepancy.label} · {metrics.widestDiscrepancy.spreadPct.toFixed(1)}%
                variance
              </>
            ) : (
              'Select 2+ sources to compare'
            )}
          </div>
          <div className="mt-1">
            <button
              type="button"
              onClick={() => onNavigateTab('discrepancies')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
            >
              Open discrepancy report
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:border-t sm:border-[#E2E8F0] lg:border-t-0">
          <div className="text-xs font-medium text-[#64748B]">Audited Revisions Logged</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#0F172A]">
            {formatNumber(metrics.totalRevisions)}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            Across {sources.length} tracked registries & outlets
          </div>
        </div>

        <div className="p-5 sm:border-l sm:border-t sm:border-[#E2E8F0] lg:border-l-0 lg:border-t-0">
          {isOwner ? (
            <>
              <div className="text-xs font-medium text-[#64748B]">Staging Queue Pending</div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1E3A8A]">
                {formatNumber(pendingStagingCount)}
              </div>
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => onNavigateTab('ingestion')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                >
                  Review incoming candidates
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-medium text-[#64748B]">Verified Ledger Coverage</div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1E3A8A]">
                {formatNumber(metrics.verifiedTotal)}
                <span className="ml-1.5 text-sm font-normal text-[#64748B]">
                  ({metrics.verifiedPct}%)
                </span>
              </div>
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => onNavigateTab('sources')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                >
                  Browse source registry
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Interactive Year x Month & Source Consensus Heatmaps */}
      <BirthHeatmapsPanel
        sources={sources}
        reports={reports}
        loading={loading}
        initialMode="calendar"
        onInspectReport={onInspectReport}
      />

      {/* Bottom Split: Period Discrepancy Matrix + Recent Revision Diffs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Period Discrepancy Matrix */}
        <section className="rounded-lg border border-[#E2E8F0] bg-white lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3.5">
            <div>
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                Period Discrepancy Matrix
              </h2>
              <p className="text-xs text-[#64748B]">
                Periods with two or more concurrent reporting sources
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateTab('discrepancies')}
                className="text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
              >
                Full discrepancy report
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('explorer')}
                className="text-xs font-medium text-[#475569] hover:text-[#0F172A] hover:underline whitespace-nowrap cursor-pointer"
              >
                Open ledger
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#FAFAFA] text-[#475569]">
                  <th className="px-5 py-2.5 font-medium">Period</th>
                  <th className="px-3 py-2.5 font-medium">Lowest Reported</th>
                  <th className="px-3 py-2.5 font-medium">Highest Reported</th>
                  <th className="px-5 py-2.5 text-right font-medium">Spread</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {periodDiscrepancies.slice(0, 8).map((item) => (
                  <tr
                    key={item.periodValue}
                    className="transition-colors hover:bg-[#F8FAFC]"
                  >
                    <td className="px-5 py-3 font-mono font-medium text-[#0F172A] whitespace-nowrap">
                      {item.label}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onInspectReport(item.minReport.id)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        <span className="font-mono font-medium tabular-nums text-[#0F172A]">
                          {formatNumber(item.minReport.count)}
                        </span>
                        <span className="ml-1.5 text-[#64748B]">{item.minReport.sourceName}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onInspectReport(item.maxReport.id)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        <span className="font-mono font-medium tabular-nums text-[#0F172A]">
                          {formatNumber(item.maxReport.count)}
                        </span>
                        <span className="ml-1.5 text-[#64748B]">{item.maxReport.sourceName}</span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className="font-medium text-[#B45309]">
                        +{formatNumber(item.spread)}
                      </span>
                      <span className="ml-1.5 text-[#64748B]">
                        ({item.spreadPct.toFixed(1)}%)
                      </span>
                    </td>
                  </tr>
                ))}
                {periodDiscrepancies.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-[#64748B]">
                      No multi-source overlaps in the current filter scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Revision History Timeline */}
        <section className="rounded-lg border border-[#E2E8F0] bg-white lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3.5">
            <div>
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                Recent Figure Revisions
              </h2>
              <p className="text-xs text-[#64748B]">
                Audit trail of updated totals & bulletin corrections
              </p>
            </div>
            <History className="h-4 w-4 text-[#64748B]" />
          </div>

          <div className="divide-y divide-[#F1F5F9]">
            {revisions.slice(0, 6).map((rev) => {
              const delta = rev.newValue - rev.previousValue;
              return (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => onInspectReport(rev.birthReportId)}
                  className="block w-full px-5 py-3.5 text-left transition-colors hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-medium text-[#0F172A]">
                      {rev.sourceName}{' '}
                      <span className="text-[#64748B]">
                        · {rev.periodValue ? formatPeriodLabel(rev.periodValue) : ''}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {formatDateShort(rev.detectedAt)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="text-[#64748B] line-through">
                      {formatNumber(rev.previousValue)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-[#94A3B8]" />
                    <span className="font-semibold text-[#0F172A]">
                      {formatNumber(rev.newValue)}
                    </span>
                    <span
                      className={cn(
                        'text-[11px] font-medium',
                        delta >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                      )}
                    >
                      ({delta >= 0 ? `+${formatNumber(delta)}` : formatNumber(delta)})
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#475569]">
                    {rev.changeReason}
                  </p>
                  <div className="mt-1 text-[11px] text-[#64748B]">
                    {rev.detectedBy}
                    {rev.actorEmail ? ` · ${rev.actorEmail}` : ''}
                  </div>
                </button>
              );
            })}
            {revisions.length === 0 && (
              <div className="px-5 py-8 text-center text-xs text-[#64748B]">
                No figure revisions logged yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
