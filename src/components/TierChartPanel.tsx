import React, { useMemo, useRef, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, X } from 'lucide-react';
import { exportChartToPng } from '../lib/chart-export';
import { computeLinearTrendProjection } from '../lib/trend-projection';
import {
  cn,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
} from '../lib/utils';
import type {
  BirthReportRecord,
  CredibilityTier,
  PeriodType,
  SourceRecord,
} from '../types/observatory';

export type ConfidenceScope = 'verified' | 'active' | 'all';

interface ChartPeriodRow {
  periodValue: string;
  label: string;
  isProjection?: boolean;
  projEstimate?: number;
  projLow?: number;
  projHigh?: number;
  projBand?: [number, number];
  [key: string]: string | number | boolean | [number, number] | undefined;
}

interface TierChartPanelProps {
  tier: CredibilityTier;
  shortTitle: string;
  description: string;
  footnote: string;
  fileSlug: string;
  isPrimary?: boolean;
  tierSources: SourceRecord[];
  tierAllReports: BirthReportRecord[];
  periodType: PeriodType;
  chartMode: 'line' | 'bar';
  yearFilter: string;
  confidenceScope: ConfidenceScope;
  hiddenSourceIds: number[];
  onToggleSource: (sourceId: number) => void;
  showProjection: boolean;
  activeHorizon: number;
  loading: boolean;
  onInspectReport: (reportId: number) => void;
  onResetFilters: () => void;
  onSwitchToMonthly?: () => void;
  onSwitchToActiveScope?: () => void;
  onHidePanel?: () => void;
}

export function TierChartPanel({
  tier,
  shortTitle,
  description,
  footnote,
  fileSlug,
  isPrimary = false,
  tierSources,
  tierAllReports,
  periodType,
  chartMode,
  yearFilter,
  confidenceScope,
  hiddenSourceIds,
  onToggleSource,
  showProjection,
  activeHorizon,
  loading,
  onInspectReport,
  onResetFilters,
  onSwitchToMonthly,
  onSwitchToActiveScope,
  onHidePanel,
}: TierChartPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  const activeTierSources = useMemo(
    () => tierSources.filter((s) => !hiddenSourceIds.includes(s.id)),
    [tierSources, hiddenSourceIds]
  );

  const filteredReports = useMemo(() => {
    return tierAllReports.filter((r) => {
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
  }, [tierAllReports, periodType, yearFilter, hiddenSourceIds, confidenceScope]);

  // Diagnostic counts for context-aware empty states
  const tierDiagnostics = useMemo(() => {
    const monthlyActiveCount = tierAllReports.filter(
      (r) => r.periodType === 'Monthly' && r.confidenceStatus !== 'Superseded'
    ).length;
    const periodAnyStatusCount = tierAllReports.filter(
      (r) =>
        r.periodType === periodType &&
        (yearFilter === 'All' || r.periodValue.startsWith(yearFilter)) &&
        !hiddenSourceIds.includes(r.sourceId) &&
        r.confidenceStatus !== 'Superseded'
    ).length;
    return { monthlyActiveCount, periodAnyStatusCount };
  }, [tierAllReports, periodType, yearFilter, hiddenSourceIds]);

  const { chartData, cellReportMap } = useMemo(() => {
    const byPeriod = new Map<string, BirthReportRecord[]>();
    for (const r of filteredReports) {
      const list = byPeriod.get(r.periodValue) || [];
      list.push(r);
      byPeriod.set(r.periodValue, list);
    }

    const sortedPeriods = Array.from(byPeriod.keys()).sort();
    const lookup = new Map<string, BirthReportRecord>();
    const rows: ChartPeriodRow[] = [];

    for (const periodValue of sortedPeriods) {
      const list = byPeriod.get(periodValue) || [];
      const row: ChartPeriodRow = {
        periodValue,
        label: formatPeriodLabel(periodValue),
      };

      for (const r of list) {
        const key = `s_${r.sourceId}`;
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
    }

    return { chartData: rows, cellReportMap: lookup };
  }, [filteredReports]);

  const plottedSources = useMemo(() => {
    const present = new Set(filteredReports.map((r) => r.sourceId));
    return activeTierSources.filter((s) => present.has(s.id));
  }, [activeTierSources, filteredReports]);

  const projection = useMemo(() => {
    if (!showProjection) return null;
    return computeLinearTrendProjection(filteredReports, periodType, activeHorizon);
  }, [showProjection, filteredReports, periodType, activeHorizon]);

  const displayChartData = useMemo(() => {
    if (!showProjection || !projection?.available || projection.points.length === 0) {
      return chartData;
    }

    const withAnchor: ChartPeriodRow[] = chartData.map((row) => {
      if (
        row.periodValue === projection.anchorPeriodValue &&
        projection.anchorConsensusValue !== undefined
      ) {
        return {
          ...row,
          projEstimate: projection.anchorConsensusValue,
          projLow: projection.anchorConsensusValue,
          projHigh: projection.anchorConsensusValue,
          projBand: [projection.anchorConsensusValue, projection.anchorConsensusValue],
        };
      }
      return row;
    });

    const futureRows: ChartPeriodRow[] = projection.points.map((pt) => ({
      periodValue: pt.periodValue,
      label: pt.label,
      isProjection: true,
      projEstimate: pt.estimate,
      projLow: pt.low,
      projHigh: pt.high,
      projBand: [pt.low, pt.high],
    }));

    return [...withAnchor, ...futureRows];
  }, [chartData, showProjection, projection]);

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
      const projLabel =
        showProjection && projection?.available && projection.summary
          ? ` · Projection: +${projection.summary.horizonSteps} ${projection.summary.unitLabel}${
              projection.summary.horizonSteps === 1 ? '' : 's'
            } OLS (95% CI)`
          : '';
      const filterDesc = `${tier} · ${periodType} · Year: ${yearFilter} · Scope: ${scopeLabel} · ${plottedSources.length} source${
        plottedSources.length === 1 ? '' : 's'
      }${projLabel}`;

      const legendItems = [
        ...plottedSources.map((s) => ({ label: s.name, color: s.seriesColor })),
        ...(showProjection && projection?.available
          ? [{ label: 'Consensus Projection (95% CI)', color: '#1E3A8A' }]
          : []),
      ];

      await exportChartToPng({
        containerEl: chartContainerRef.current,
        title: `Gaza Birth Statistics — ${shortTitle} (${periodType})`,
        subtitle:
          showProjection && projection?.available
            ? `${description} · with optional OLS linear trend projection and 95% confidence band`
            : description,
        activeFiltersLabel: filterDesc,
        legendItems,
        filename: `gaza-births-${fileSlug}-${periodType.toLowerCase()}${
          showProjection && projection?.available ? '-projected' : ''
        }-${new Date().toISOString().slice(0, 10)}.png`,
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

  const chartHeightClass = isPrimary ? 'h-[380px]' : 'h-[320px]';
  const isMonthlyBarMode = chartMode === 'bar' && periodType === 'Monthly';
  const monthlyBarMinWidth = isMonthlyBarMode
    ? Math.max(0, displayChartData.length * 46 + 96)
    : 0;

  return (
    <section className="rounded-lg border border-[#E2E8F0] bg-white">
      {/* Panel Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="font-serif text-base md:text-lg font-semibold text-[#0F172A]">
              {shortTitle}
            </h2>
            <span className="text-xs text-[#64748B]">
              {tierSources.length} source{tierSources.length === 1 ? '' : 's'}
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">
                {filteredReports.length} report{filteredReports.length === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#475569]">{description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportPng}
            disabled={exporting || chartData.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#1E3A8A]" />
            {exporting ? 'Rendering...' : 'Export PNG'}
          </button>

          {!isPrimary && onHidePanel && (
            <button
              type="button"
              onClick={onHidePanel}
              aria-label={`Hide ${shortTitle} chart`}
              className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Hide
            </button>
          )}
        </div>
      </div>

      {exportMessage && (
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-2 text-xs text-[#334155]">
          {exportMessage}
        </div>
      )}

      {/* Per-Tier Source Series Filter Bar (Clean Editorial Toggles — No Pill Boxes) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#F1F5F9] bg-[#FAFAFA] px-5 py-2.5">
        <span className="text-xs font-medium text-[#64748B]">Tier Sources:</span>
        {tierSources.length === 0 ? (
          <span className="text-xs text-[#64748B]">No sources registered in this tier.</span>
        ) : (
          tierSources.map((src) => {
            const isActive = !hiddenSourceIds.includes(src.id);
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => onToggleSource(src.id)}
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
          })
        )}
        {showProjection && projection?.available && (
          <span className="inline-flex items-center gap-2 py-0.5 text-xs font-medium text-[#1E3A8A] whitespace-nowrap shrink-0">
            <span
              className="inline-block h-0 w-4 shrink-0 border-t-2 border-dashed border-[#1E3A8A]"
              aria-hidden="true"
            />
            <span>Consensus Projection (95% CI)</span>
          </span>
        )}
      </div>

      {/* Recharts Visualization Canvas */}
      <div ref={chartContainerRef} className="p-5">
        {loading ? (
          <div className={cn(chartHeightClass, 'w-full animate-pulse rounded bg-[#F8FAFC]')} />
        ) : displayChartData.length === 0 ? (
          <div
            className={cn(
              isPrimary ? 'h-[320px]' : 'h-[240px]',
              'flex flex-col items-center justify-center px-4 text-center'
            )}
          >
            {periodType === 'Yearly' && tierDiagnostics.monthlyActiveCount > 0 ? (
              <>
                <p className="text-sm font-medium text-[#0F172A]">
                  No annual birth records are logged for {shortTitle}.
                </p>
                <p className="mt-1 max-w-md text-xs text-[#64748B]">
                  This tier currently contains {tierDiagnostics.monthlyActiveCount} monthly report
                  {tierDiagnostics.monthlyActiveCount === 1 ? '' : 's'}. Switch aggregation to
                  Monthly to inspect those observations.
                </p>
                {onSwitchToMonthly && (
                  <button
                    type="button"
                    onClick={onSwitchToMonthly}
                    className="mt-4 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Switch to Monthly View
                  </button>
                )}
              </>
            ) : confidenceScope === 'verified' && tierDiagnostics.periodAnyStatusCount > 0 ? (
              <>
                <p className="text-sm font-medium text-[#0F172A]">
                  No Verified {periodType.toLowerCase()} records exist in {shortTitle}.
                </p>
                <p className="mt-1 max-w-md text-xs text-[#64748B]">
                  There are {tierDiagnostics.periodAnyStatusCount} Disputed or Pending Review report
                  {tierDiagnostics.periodAnyStatusCount === 1 ? '' : 's'} in this tier under the
                  current timeframe.
                </p>
                {onSwitchToActiveScope && (
                  <button
                    type="button"
                    onClick={onSwitchToActiveScope}
                    className="mt-4 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Show Active Statuses
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[#0F172A]">
                  No {shortTitle} statistics match the current chart filters.
                </p>
                <p className="mt-1 text-xs text-[#64748B]">
                  Re-enable sources in this tier or widen the year and verification status filter.
                </p>
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="mt-4 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Reset Chart Filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div className={cn(isMonthlyBarMode ? 'overflow-x-auto pb-1' : '')}>
            <div
              className={cn(chartHeightClass, 'w-full')}
              style={
                isMonthlyBarMode && monthlyBarMinWidth > 0
                  ? { minWidth: `${monthlyBarMinWidth}px` }
                  : undefined
              }
            >
              <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'line' ? (
                <ComposedChart
                  data={displayChartData}
                  margin={{ top: 18, right: 20, left: 10, bottom: 8 }}
                  onClick={(state) => {
                    const idx =
                      typeof state?.activeTooltipIndex === 'number'
                        ? state.activeTooltipIndex
                        : -1;
                    const byIndex = idx >= 0 ? displayChartData[idx] : undefined;
                    const byLabel = state?.activeLabel
                      ? displayChartData.find((row) => row.label === String(state.activeLabel))
                      : undefined;
                    const target = byIndex || byLabel;
                    if (target?.periodValue && !target.isProjection) {
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
                      const row = payload[0]?.payload as ChartPeriodRow | undefined;
                      const periodVal = String(row?.periodValue || '');

                      if (row?.isProjection) {
                        return (
                          <div className="min-w-[240px] rounded-md border border-[#BFDBFE] bg-white p-3.5 shadow-sm">
                            <div className="flex items-baseline justify-between border-b border-[#E2E8F0] pb-2">
                              <span className="font-serif text-sm font-semibold text-[#1E3A8A]">
                                {label}
                              </span>
                              <span className="font-mono text-[11px] text-[#64748B]">
                                Projected · {periodVal}
                              </span>
                            </div>
                            <div className="mt-2.5 space-y-1.5 text-xs">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-[#334155]">Linear Consensus Est.</span>
                                <span className="font-mono font-semibold tabular-nums text-[#1E3A8A]">
                                  ~{formatNumber(Number(row.projEstimate || 0))}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-[#475569]">95% Confidence Band</span>
                                <span className="font-mono tabular-nums text-[#334155]">
                                  {formatNumber(Number(row.projLow || 0))} –{' '}
                                  {formatNumber(Number(row.projHigh || 0))}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2.5 border-t border-[#F1F5F9] pt-2 text-[10px] leading-snug text-[#64748B]">
                              Statistical extrapolation from {shortTitle} historical median — not an
                              official registry report.
                            </p>
                          </div>
                        );
                      }

                      const sourceEntries = payload.filter((p) =>
                        String(p.dataKey).startsWith('s_')
                      );
                      if (sourceEntries.length === 0) return null;
                      const vals = sourceEntries
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
                            {sourceEntries.map((entry) => {
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
                              <span>Intra-tier spread</span>
                              <span className="font-mono font-medium tabular-nums text-[#B45309]">
                                ±{formatNumber(spread)} births
                              </span>
                            </div>
                          )}
                          <p className="mt-2 text-[10px] text-[#64748B]">
                            Click point to inspect citation &amp; revision log
                          </p>
                        </div>
                      );
                    }}
                  />

                  {showProjection && projection?.available && projection.anchorLabel && (
                    <ReferenceLine
                      x={projection.anchorLabel}
                      stroke="#94A3B8"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Forecast →',
                        position: 'insideTopRight',
                        fill: '#475569',
                        fontSize: 10,
                        fontFamily: 'IBM Plex Mono, monospace',
                      }}
                    />
                  )}

                  {showProjection && projection?.available && (
                    <Area
                      type="monotone"
                      dataKey="projBand"
                      name="95% Confidence Band"
                      fill="#1E3A8A"
                      fillOpacity={0.11}
                      stroke="none"
                      isAnimationActive={false}
                    />
                  )}

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
                          if (row?.periodValue && !row.isProjection) {
                            handleChartPointClick(row.periodValue, src.id);
                          }
                        },
                      }}
                    />
                  ))}

                  {showProjection && projection?.available && (
                    <Line
                      type="monotone"
                      dataKey="projEstimate"
                      name="Consensus Projection"
                      stroke="#1E3A8A"
                      strokeWidth={2.2}
                      strokeDasharray="6 4"
                      isAnimationActive={false}
                      dot={(dotProps) => {
                        const { cx, cy, payload } = dotProps as {
                          cx?: number;
                          cy?: number;
                          payload?: ChartPeriodRow;
                        };
                        if (
                          !payload?.isProjection ||
                          typeof cx !== 'number' ||
                          typeof cy !== 'number'
                        ) {
                          return <g key={`empty-${String(payload?.periodValue || cx)}`} />;
                        }
                        return (
                          <circle
                            key={`proj-dot-${payload.periodValue}`}
                            cx={cx}
                            cy={cy}
                            r={3.5}
                            fill="#FFFFFF"
                            stroke="#1E3A8A"
                            strokeWidth={2}
                          />
                        );
                      }}
                      activeDot={{
                        r: 5,
                        fill: '#1E3A8A',
                        stroke: '#FFFFFF',
                        strokeWidth: 2,
                      }}
                    />
                  )}
                </ComposedChart>
              ) : (
                <BarChart
                  data={displayChartData}
                  margin={{ top: 18, right: 20, left: 10, bottom: 8 }}
                  barGap={periodType === 'Monthly' ? 3 : 4}
                  barCategoryGap={periodType === 'Monthly' ? '28%' : '20%'}
                >
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    minTickGap={14}
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
                      const row = payload[0]?.payload as ChartPeriodRow | undefined;
                      const periodVal = String(row?.periodValue || '');

                      if (row?.isProjection) {
                        return (
                          <div className="min-w-[230px] rounded-md border border-[#BFDBFE] bg-white p-3.5 shadow-sm">
                            <div className="flex items-baseline justify-between border-b border-[#E2E8F0] pb-2">
                              <span className="font-serif text-sm font-semibold text-[#1E3A8A]">
                                {label}
                              </span>
                              <span className="font-mono text-[11px] text-[#64748B]">
                                Projected · {periodVal}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1.5 text-xs">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-[#334155]">Linear Consensus Est.</span>
                                <span className="font-mono font-semibold tabular-nums text-[#1E3A8A]">
                                  ~{formatNumber(Number(row.projEstimate || 0))}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-[#475569]">95% Confidence Band</span>
                                <span className="font-mono tabular-nums text-[#334155]">
                                  {formatNumber(Number(row.projLow || 0))} –{' '}
                                  {formatNumber(Number(row.projHigh || 0))}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const sourceEntries = payload.filter((p) =>
                        String(p.dataKey).startsWith('s_')
                      );
                      if (sourceEntries.length === 0) return null;

                      return (
                        <div className="min-w-[220px] rounded-md border border-[#CBD5E1] bg-white p-3.5 shadow-sm">
                          <div className="border-b border-[#E2E8F0] pb-2 font-serif text-sm font-semibold text-[#0F172A]">
                            {label}
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {sourceEntries.map((entry) => (
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

                  {showProjection && projection?.available && projection.anchorLabel && (
                    <ReferenceLine
                      x={projection.anchorLabel}
                      stroke="#94A3B8"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Forecast →',
                        position: 'insideTopRight',
                        fill: '#475569',
                        fontSize: 10,
                        fontFamily: 'IBM Plex Mono, monospace',
                      }}
                    />
                  )}

                  {plottedSources.map((src) => (
                    <Bar
                      key={src.id}
                      dataKey={`s_${src.id}`}
                      name={src.name}
                      fill={src.seriesColor}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={periodType === 'Monthly' ? 14 : 28}
                      className="cursor-pointer"
                      onClick={(barData) => {
                        const periodVal = barData?.payload?.periodValue as string | undefined;
                        if (periodVal && !barData?.payload?.isProjection) {
                          handleChartPointClick(periodVal, src.id);
                        }
                      }}
                    />
                  ))}

                  {showProjection && projection?.available && (
                    <Bar
                      dataKey={(row: ChartPeriodRow) =>
                        row.isProjection ? row.projEstimate : undefined
                      }
                      name="Consensus Projection"
                      fill="#1E3A8A"
                      fillOpacity={0.22}
                      stroke="#1E3A8A"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={periodType === 'Monthly' ? 14 : 28}
                      isAnimationActive={false}
                    />
                  )}
                </BarChart>
              )}
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Optional Trend Projection Diagnostics Strip */}
        {showProjection && projection && (
          <div className="mt-4 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] px-4 py-3.5">
            {projection.available && projection.summary ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[#E2E8F0]">
                  <div className="lg:pr-4">
                    <div className="text-[11px] font-medium text-[#64748B]">
                      Next Projected ({projection.summary.nextPoint.label})
                    </div>
                    <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[#1E3A8A]">
                      ~{formatNumber(projection.summary.nextPoint.estimate)} births
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[#64748B]">
                      95% CI: {formatNumber(projection.summary.nextPoint.low)} –{' '}
                      {formatNumber(projection.summary.nextPoint.high)}
                    </div>
                  </div>

                  <div className="lg:px-4">
                    <div className="text-[11px] font-medium text-[#64748B]">
                      Projected +{projection.summary.horizonSteps} {projection.summary.unitLabel}
                      {projection.summary.horizonSteps === 1 ? '' : 's'} Total
                    </div>
                    <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[#0F172A]">
                      ~{formatNumber(projection.summary.cumulativeEstimate)} births
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[#64748B]">
                      Range: {formatNumber(projection.summary.cumulativeLow)} –{' '}
                      {formatNumber(projection.summary.cumulativeHigh)}
                    </div>
                  </div>

                  <div className="lg:px-4">
                    <div className="text-[11px] font-medium text-[#64748B]">
                      Linear Trend Slope
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 font-mono text-sm font-semibold tabular-nums',
                        projection.summary.slopePerPeriod >= 0
                          ? 'text-[#15803D]'
                          : 'text-[#B45309]'
                      )}
                    >
                      {projection.summary.slopePerPeriod >= 0 ? '+' : ''}
                      {projection.summary.slopePerPeriod.toFixed(1)} /{' '}
                      {projection.summary.unitLabel}
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      OLS fit on {shortTitle} median
                    </div>
                  </div>

                  <div className="lg:pl-4">
                    <div className="text-[11px] font-medium text-[#64748B]">Model Fit</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[#0F172A]">
                      R² = {projection.summary.rSquared.toFixed(2)}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[#64748B]">
                      Based on {projection.summary.sampleSize} observed{' '}
                      {projection.summary.unitLabel}s
                    </div>
                  </div>
                </div>

                <p className="border-t border-[#E2E8F0] pt-2 text-[11px] leading-relaxed text-[#64748B]">
                  Optional statistical estimate: linear extrapolation extends the recent trajectory
                  for {shortTitle} and widens uncertainty over longer horizons; it does not predict
                  sudden displacement, facility closures, or reporting disruptions.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#475569]">{projection.unavailableReason}</p>
            )}
          </div>
        )}

        {/* Chart Footnote */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-3 text-xs text-[#64748B]">
          <span>{footnote}</span>
          <span className="font-mono tabular-nums">
            {isMonthlyBarMode && displayChartData.length > 18 ? 'Scroll horizontally to inspect all months · ' : ''}
            {filteredReports.length} plotted observation{filteredReports.length === 1 ? '' : 's'}
            {showProjection && projection?.available
              ? ` · +${projection.points.length} projected`
              : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
