import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Flag,
  History,
  Layers,
  LineChart as LineChartIcon,
  Link2,
  Lock,
  Plus,
  Scale,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Unlock,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getMarkerStrokeColor } from '../lib/context-markers';
import { computeTier1VsTier2Divergence } from '../lib/source-coverage';
import { computeLinearTrendProjection } from '../lib/trend-projection';
import { DEFAULT_ANALYTICS_URL_STATE, type AnalyticsUrlState } from '../lib/url-state';
import {
  cn,
  formatDateShort,
  formatNumber,
  formatPeriodLabel,
} from '../lib/utils';
import type {
  BirthReportRecord,
  ContextMarkerCategory,
  ContextMarkerRecord,
  CredibilityTier,
  PeriodType,
  RevisionLogRecord,
  SourceRecord,
} from '../types/observatory';
import { BirthHeatmapsPanel } from './BirthHeatmapsPanel';
import { TierChartPanel, type ConfidenceScope } from './TierChartPanel';

interface AnalyticsViewProps {
  sources: SourceRecord[];
  reports: BirthReportRecord[];
  revisions: RevisionLogRecord[];
  contextMarkers: ContextMarkerRecord[];
  pendingStagingCount: number;
  isOwner: boolean;
  loading: boolean;
  initialUrlState?: AnalyticsUrlState;
  onAnalyticsStateChange?: (state: AnalyticsUrlState) => void;
  onCopyViewLink?: () => void;
  onRefreshContextMarkers: () => Promise<void> | void;
  onInspectReport: (reportId: number) => void;
  onNavigateTab: (
    tab: 'analytics' | 'heatmaps' | 'discrepancies' | 'explorer' | 'ingestion' | 'sources'
  ) => void;
}

const MONTHLY_HORIZONS = [3, 6, 12] as const;
const YEARLY_HORIZONS = [1, 2, 3] as const;

const TIER_1: CredibilityTier = 'Tier 1 - Primary Registry';
const TIER_2: CredibilityTier = 'Tier 2 - Multilateral';
const TIER_3: CredibilityTier = 'Tier 3 - Media / Secondary';

const MARKER_CATEGORIES: ContextMarkerCategory[] = [
  'Disruption',
  'Reporting Shift',
  'Methodology',
  'Milestone',
];

function roundUpAxisMax(rawMax: number): number {
  if (rawMax <= 0) return 1000;
  const padded = rawMax * 1.08;
  if (padded <= 5000) return Math.ceil(padded / 250) * 250;
  if (padded <= 15000) return Math.ceil(padded / 500) * 500;
  if (padded <= 60000) return Math.ceil(padded / 1000) * 1000;
  return Math.ceil(padded / 2500) * 2500;
}

export function AnalyticsView({
  sources,
  reports,
  revisions,
  contextMarkers,
  pendingStagingCount,
  isOwner,
  loading,
  initialUrlState,
  onAnalyticsStateChange,
  onCopyViewLink,
  onRefreshContextMarkers,
  onInspectReport,
  onNavigateTab,
}: AnalyticsViewProps) {
  const { authFetch } = useAuth();
  const initial = initialUrlState ?? DEFAULT_ANALYTICS_URL_STATE;

  const [periodType, setPeriodType] = useState<PeriodType>(initial.periodType);
  const [chartMode, setChartMode] = useState<'line' | 'bar'>(initial.chartMode);
  const [yearFilter, setYearFilter] = useState<string>(initial.yearFilter);
  const [confidenceScope, setConfidenceScope] = useState<ConfidenceScope>(
    initial.confidenceScope
  );
  const [hiddenSourceIds, setHiddenSourceIds] = useState<number[]>([]);
  const [showTier2Chart, setShowTier2Chart] = useState(initial.showTier2Chart);
  const [showTier3Chart, setShowTier3Chart] = useState(initial.showTier3Chart);
  const [lockYAxis, setLockYAxis] = useState(initial.lockYAxis);
  const [showContextMarkers, setShowContextMarkers] = useState(
    initial.showContextMarkers
  );
  const [showProjection, setShowProjection] = useState(initial.showProjection);
  const [monthlyHorizon, setMonthlyHorizon] = useState<(typeof MONTHLY_HORIZONS)[number]>(
    initial.monthlyHorizon
  );
  const [yearlyHorizon, setYearlyHorizon] = useState<(typeof YEARLY_HORIZONS)[number]>(
    initial.yearlyHorizon
  );

  // Shareable URL feedback
  const [linkCopied, setLinkCopied] = useState(false);
  const linkTimerRef = useRef<number | null>(null);

  // Owner custom context markers modal state
  const [markerModalOpen, setMarkerModalOpen] = useState(false);
  const [markerPeriod, setMarkerPeriod] = useState('2025-06');
  const [markerTitle, setMarkerTitle] = useState('');
  const [markerCategory, setMarkerCategory] =
    useState<ContextMarkerCategory>('Reporting Shift');
  const [markerNotes, setMarkerNotes] = useState('');
  const [markerSubmitting, setMarkerSubmitting] = useState(false);
  const [markerError, setMarkerError] = useState<string | null>(null);
  const [deletingMarkerId, setDeletingMarkerId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (linkTimerRef.current !== null) {
        window.clearTimeout(linkTimerRef.current);
      }
    };
  }, []);

  // Push filter state upward for URL query-param synchronization
  useEffect(() => {
    if (!onAnalyticsStateChange) return;
    onAnalyticsStateChange({
      periodType,
      chartMode,
      yearFilter,
      confidenceScope,
      showTier2Chart,
      showTier3Chart,
      lockYAxis,
      showContextMarkers,
      showProjection,
      monthlyHorizon,
      yearlyHorizon,
    });
  }, [
    periodType,
    chartMode,
    yearFilter,
    confidenceScope,
    showTier2Chart,
    showTier3Chart,
    lockYAxis,
    showContextMarkers,
    showProjection,
    monthlyHorizon,
    yearlyHorizon,
    onAnalyticsStateChange,
  ]);

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const r of reports) {
      yrs.add(r.periodValue.slice(0, 4));
    }
    return Array.from(yrs).sort().reverse();
  }, [reports]);

  // Partition sources and reports by credibility tier
  const tierPartitions = useMemo(() => {
    const t1Sources = sources.filter((s) => s.credibilityTier === TIER_1);
    const t2Sources = sources.filter((s) => s.credibilityTier === TIER_2);
    const t3Sources = sources.filter((s) => s.credibilityTier === TIER_3);

    const t1Ids = new Set(t1Sources.map((s) => s.id));
    const t2Ids = new Set(t2Sources.map((s) => s.id));
    const t3Ids = new Set(t3Sources.map((s) => s.id));

    return {
      tier1: {
        sources: t1Sources,
        reports: reports.filter((r) => t1Ids.has(r.sourceId)),
      },
      tier2: {
        sources: t2Sources,
        reports: reports.filter((r) => t2Ids.has(r.sourceId)),
      },
      tier3: {
        sources: t3Sources,
        reports: reports.filter((r) => t3Ids.has(r.sourceId)),
      },
    };
  }, [sources, reports]);

  const enabledTiers = useMemo(() => {
    const list: CredibilityTier[] = [TIER_1];
    if (showTier2Chart) list.push(TIER_2);
    if (showTier3Chart) list.push(TIER_3);
    return list;
  }, [showTier2Chart, showTier3Chart]);

  const activeTierScopeLabel = useMemo(() => {
    const labels = ['Tier 1'];
    if (showTier2Chart) labels.push('Tier 2');
    if (showTier3Chart) labels.push('Tier 3');
    return labels.join(' · ');
  }, [showTier2Chart, showTier3Chart]);

  const activeHorizon = periodType === 'Monthly' ? monthlyHorizon : yearlyHorizon;

  // Reports visible across currently enabled tier charts (drives KPI strip, Period Discrepancy Matrix & Locked Y-Axis)
  const visibleTierFilteredReports = useMemo(() => {
    const allowedSourceIds = new Set(
      sources
        .filter((s) => enabledTiers.includes(s.credibilityTier) && !hiddenSourceIds.includes(s.id))
        .map((s) => s.id)
    );

    return reports.filter((r) => {
      if (!allowedSourceIds.has(r.sourceId)) return false;
      if (r.periodType !== periodType) return false;
      if (yearFilter !== 'All' && !r.periodValue.startsWith(yearFilter)) return false;
      if (confidenceScope === 'verified' && r.confidenceStatus !== 'Verified') {
        return false;
      }
      if (confidenceScope === 'active' && r.confidenceStatus === 'Superseded') {
        return false;
      }
      return true;
    });
  }, [sources, enabledTiers, hiddenSourceIds, reports, periodType, yearFilter, confidenceScope]);

  // Synchronized Y-axis maximum across all enabled Tier charts (optional, default OFF)
  const lockedYMax = useMemo(() => {
    if (!lockYAxis) return null;

    let maxVal = 0;
    for (const r of visibleTierFilteredReports) {
      if (r.count > maxVal) maxVal = r.count;
    }

    if (showProjection) {
      const enabledTierReportSets: BirthReportRecord[][] = [tierPartitions.tier1.reports];
      if (showTier2Chart) enabledTierReportSets.push(tierPartitions.tier2.reports);
      if (showTier3Chart) enabledTierReportSets.push(tierPartitions.tier3.reports);

      for (const tierReports of enabledTierReportSets) {
        const scoped = tierReports.filter((r) => {
          if (r.periodType !== periodType) return false;
          if (yearFilter !== 'All' && !r.periodValue.startsWith(yearFilter)) return false;
          if (hiddenSourceIds.includes(r.sourceId)) return false;
          if (confidenceScope === 'verified' && r.confidenceStatus !== 'Verified') return false;
          if (confidenceScope === 'active' && r.confidenceStatus === 'Superseded') return false;
          return true;
        });

        const projection = computeLinearTrendProjection(scoped, periodType, activeHorizon);
        if (projection.available) {
          for (const pt of projection.points) {
            if (pt.high > maxVal) maxVal = pt.high;
          }
        }
      }
    }

    return maxVal > 0 ? roundUpAxisMax(maxVal) : null;
  }, [
    lockYAxis,
    visibleTierFilteredReports,
    showProjection,
    tierPartitions,
    showTier2Chart,
    showTier3Chart,
    periodType,
    yearFilter,
    hiddenSourceIds,
    confidenceScope,
    activeHorizon,
  ]);

  // Systemic benchmark comparing Tier 1 primary registries vs Tier 2 multilateral agencies
  const tierBenchmark = useMemo(
    () => computeTier1VsTier2Divergence(reports, periodType, yearFilter, confidenceScope),
    [reports, periodType, yearFilter, confidenceScope]
  );

  const periodDiscrepancies = useMemo(() => {
    const byPeriod = new Map<string, BirthReportRecord[]>();
    for (const r of visibleTierFilteredReports) {
      const list = byPeriod.get(r.periodValue) || [];
      list.push(r);
      byPeriod.set(r.periodValue, list);
    }

    const discrepancies: Array<{
      periodValue: string;
      label: string;
      minReport: BirthReportRecord;
      maxReport: BirthReportRecord;
      spread: number;
      spreadPct: number;
      sourceCount: number;
    }> = [];

    for (const [periodValue, list] of byPeriod.entries()) {
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
    return discrepancies;
  }, [visibleTierFilteredReports]);

  // Summary metrics aligned with enabled tier charts
  const metrics = useMemo(() => {
    const latestVerified = visibleTierFilteredReports
      .filter((r) => r.confidenceStatus === 'Verified')
      .sort((a, b) => b.periodValue.localeCompare(a.periodValue))[0];

    const widestDiscrepancy = [...periodDiscrepancies].sort((a, b) => b.spread - a.spread)[0];

    const verifiedTotal = reports.filter((r) => r.confidenceStatus === 'Verified').length;
    const verifiedPct = reports.length > 0 ? Math.round((verifiedTotal / reports.length) * 100) : 0;

    return {
      latestVerified,
      widestDiscrepancy,
      totalRevisions: revisions.length,
      verifiedTotal,
      verifiedPct,
    };
  }, [visibleTierFilteredReports, periodDiscrepancies, reports, revisions.length]);

  const toggleSource = (sourceId: number) => {
    setHiddenSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const resetChartFilters = () => {
    setYearFilter('All');
    setConfidenceScope('all');
    setHiddenSourceIds([]);
  };

  const handleCopyLinkClick = () => {
    if (!onCopyViewLink) return;
    onCopyViewLink();
    setLinkCopied(true);
    if (linkTimerRef.current !== null) {
      window.clearTimeout(linkTimerRef.current);
    }
    linkTimerRef.current = window.setTimeout(() => {
      setLinkCopied(false);
      linkTimerRef.current = null;
    }, 2200);
  };

  const handleCreateMarker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setMarkerError(null);

    const trimmedPeriod = markerPeriod.trim();
    const trimmedTitle = markerTitle.trim();
    const trimmedNotes = markerNotes.trim();

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmedPeriod)) {
      setMarkerError('Month must follow YYYY-MM format (e.g., 2024-05).');
      return;
    }
    if (trimmedTitle.length < 2) {
      setMarkerError('Enter a short descriptive milestone title.');
      return;
    }

    setMarkerSubmitting(true);
    try {
      const res = await authFetch('/api/context-markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodValue: trimmedPeriod,
          title: trimmedTitle,
          category: markerCategory,
          notes: trimmedNotes,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || 'Could not save context marker.');
      }
      setMarkerTitle('');
      setMarkerNotes('');
      setShowContextMarkers(true);
      await onRefreshContextMarkers();
    } catch (err: unknown) {
      setMarkerError(err instanceof Error ? err.message : 'Unable to save marker.');
    } finally {
      setMarkerSubmitting(false);
    }
  };

  const handleDeleteMarker = async (dbId: number) => {
    if (!isOwner) return;
    setMarkerError(null);
    setDeletingMarkerId(dbId);
    try {
      const res = await authFetch(`/api/context-markers/${dbId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || 'Could not delete context marker.');
      }
      await onRefreshContextMarkers();
    } catch (err: unknown) {
      setMarkerError(err instanceof Error ? err.message : 'Unable to delete marker.');
    } finally {
      setDeletingMarkerId(null);
    }
  };

  const activeMarkersEnabled = showContextMarkers && periodType === 'Monthly';

  return (
    <div className="space-y-8">
      {/* Editorial Section Intro */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Multi-Source Demographic Reconciliation
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
            Track monthly and annual Gaza birth figures starting from Tier 1 primary hospital and
            civil registries, with optional separate charts for Tier 2 multilateral agency estimates
            and Tier 3 media briefings. Select any plotted figure to inspect its verbatim quote and
            revision history.
          </p>
        </div>

        {onCopyViewLink && (
          <button
            type="button"
            onClick={handleCopyLinkClick}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {linkCopied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#15803D]" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5 text-[#1E3A8A]" />
                <span>Copy View Link</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Shared Analytics Control Bar */}
      <section
        aria-label="Analytics chart controls"
        className="rounded-lg border border-[#E2E8F0] bg-white"
      >
        {/* Row 1: Aggregation, Visualization Mode, Year & Status */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F1F5F9] px-5 py-3.5">
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

        {/* Row 2: Optional Tier 2 / Tier 3 Charts, Lock Y-Axis, Context Markers & Trend Projection */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FAFAFA] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748B] whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 text-[#64748B]" />
              Tiers:
            </span>

            <button
              type="button"
              aria-pressed={showTier2Chart}
              onClick={() => setShowTier2Chart((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                showTier2Chart
                  ? 'border-[#1E3A8A] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <span>Tier 2 — Multilateral</span>
              <span className="font-mono text-[10px] opacity-75">
                {showTier2Chart ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={showTier3Chart}
              onClick={() => setShowTier3Chart((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                showTier3Chart
                  ? 'border-[#1E3A8A] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <span>Tier 3 — Media</span>
              <span className="font-mono text-[10px] opacity-75">
                {showTier3Chart ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Synchronized Y-Axis Scale Toggle (Default OFF) */}
            <button
              type="button"
              aria-pressed={lockYAxis}
              onClick={() => setLockYAxis((v) => !v)}
              title="Lock all visible Tier charts to a shared vertical scale for direct amplitude comparison"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                lockYAxis
                  ? 'border-[#0F766E] bg-[#F0FDFA] text-[#0F766E]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              {lockYAxis ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              <span>Lock Y-Axis</span>
              <span className="font-mono text-[10px] opacity-80">
                {lockYAxis && lockedYMax ? `0–${formatNumber(lockedYMax)}` : 'OFF'}
              </span>
            </button>
          </div>

          {/* Right Group: Historical Context Markers + Trend Projection */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Context Markers Toggle (Default OFF, Monthly mode) */}
            <button
              type="button"
              aria-pressed={showContextMarkers}
              disabled={periodType !== 'Monthly'}
              onClick={() => setShowContextMarkers((v) => !v)}
              title={
                periodType === 'Monthly'
                  ? 'Overlay curated and custom historical reporting milestones on monthly charts'
                  : 'Switch to Monthly mode to overlay historical context markers'
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 disabled:cursor-not-allowed disabled:opacity-50',
                activeMarkersEnabled
                  ? 'border-[#B45309] bg-[#FFFBEB] text-[#92400E]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <Flag className="h-3.5 w-3.5" />
              <span>Context Markers</span>
              <span className="font-mono text-[10px] opacity-80">
                {periodType !== 'Monthly' ? 'Monthly' : showContextMarkers ? 'ON' : 'OFF'}
              </span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  setMarkerError(null);
                  setMarkerModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#1E3A8A]" />
                <span>Markers</span>
              </button>
            )}

            {/* Optional Trend Projection Toggle + Selectable Horizon */}
            <button
              type="button"
              aria-pressed={showProjection}
              onClick={() => setShowProjection((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                showProjection
                  ? 'border-[#1E3A8A] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Projection</span>
              <span className="font-mono text-[10px] opacity-75">
                {showProjection ? 'ON' : 'OFF'}
              </span>
            </button>

            {showProjection && (
              <div
                className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
                role="group"
                aria-label="Projection horizon"
              >
                {periodType === 'Monthly'
                  ? MONTHLY_HORIZONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMonthlyHorizon(m)}
                        className={cn(
                          'rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                          monthlyHorizon === m
                            ? 'bg-white text-[#1E3A8A] shadow-xs'
                            : 'text-[#475569] hover:text-[#0F172A]'
                        )}
                      >
                        +{m}m
                      </button>
                    ))
                  : YEARLY_HORIZONS.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setYearlyHorizon(y)}
                        className={cn(
                          'rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                          yearlyHorizon === y
                            ? 'bg-white text-[#1E3A8A] shadow-xs'
                            : 'text-[#475569] hover:text-[#0F172A]'
                        )}
                      >
                        +{y}y
                      </button>
                    ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Primary Focal Chart: Tier 1 — Primary Registry Sources Only */}
      <TierChartPanel
        tier={TIER_1}
        shortTitle="Tier 1 — Primary Registry"
        description="Official hospital delivery ledgers, civil status certificates, and primary health ministry bulletins."
        footnote="Primary registry baseline: hospital delivery logs (MOH), civil birth registration ledgers (MOI), and official MOH channel updates."
        fileSlug="tier1-primary"
        isPrimary
        tierSources={tierPartitions.tier1.sources}
        tierAllReports={tierPartitions.tier1.reports}
        periodType={periodType}
        chartMode={chartMode}
        yearFilter={yearFilter}
        confidenceScope={confidenceScope}
        hiddenSourceIds={hiddenSourceIds}
        onToggleSource={toggleSource}
        showProjection={showProjection}
        activeHorizon={activeHorizon}
        lockedYMax={lockedYMax}
        contextMarkers={contextMarkers}
        showContextMarkers={activeMarkersEnabled}
        loading={loading}
        onInspectReport={onInspectReport}
        onResetFilters={resetChartFilters}
        onSwitchToMonthly={() => setPeriodType('Monthly')}
        onSwitchToActiveScope={() => setConfidenceScope('active')}
      />

      {/* Optional Separate Chart: Tier 2 — Multilateral Sources */}
      {showTier2Chart && (
        <TierChartPanel
          tier={TIER_2}
          shortTitle="Tier 2 — Multilateral Agencies"
          description="Humanitarian agency sitreps and population-level demographic projections from UN OCHA and UNFPA."
          footnote="Multilateral estimates often reflect population modeling or alternating monthly situation reports rather than hospital-level civil registration."
          fileSlug="tier2-multilateral"
          tierSources={tierPartitions.tier2.sources}
          tierAllReports={tierPartitions.tier2.reports}
          periodType={periodType}
          chartMode={chartMode}
          yearFilter={yearFilter}
          confidenceScope={confidenceScope}
          hiddenSourceIds={hiddenSourceIds}
          onToggleSource={toggleSource}
          showProjection={showProjection}
          activeHorizon={activeHorizon}
          lockedYMax={lockedYMax}
          contextMarkers={contextMarkers}
          showContextMarkers={activeMarkersEnabled}
          loading={loading}
          onInspectReport={onInspectReport}
          onResetFilters={resetChartFilters}
          onSwitchToMonthly={() => setPeriodType('Monthly')}
          onSwitchToActiveScope={() => setConfidenceScope('active')}
          onHidePanel={() => setShowTier2Chart(false)}
        />
      )}

      {/* Optional Separate Chart: Tier 3 — Media / Secondary Sources */}
      {showTier3Chart && (
        <TierChartPanel
          tier={TIER_3}
          shortTitle="Tier 3 — Media & Secondary Outlets"
          description="News reporting and secondary press briefings that cite or summarize birth statistics without primary registry extracts."
          footnote="Secondary media figures are plotted separately to preserve primary registry integrity and highlight reporting discrepancies or pending review status."
          fileSlug="tier3-media"
          tierSources={tierPartitions.tier3.sources}
          tierAllReports={tierPartitions.tier3.reports}
          periodType={periodType}
          chartMode={chartMode}
          yearFilter={yearFilter}
          confidenceScope={confidenceScope}
          hiddenSourceIds={hiddenSourceIds}
          onToggleSource={toggleSource}
          showProjection={showProjection}
          activeHorizon={activeHorizon}
          lockedYMax={lockedYMax}
          contextMarkers={contextMarkers}
          showContextMarkers={activeMarkersEnabled}
          loading={loading}
          onInspectReport={onInspectReport}
          onResetFilters={resetChartFilters}
          onSwitchToMonthly={() => setPeriodType('Monthly')}
          onSwitchToActiveScope={() => setConfidenceScope('active')}
          onHidePanel={() => setShowTier3Chart(false)}
        />
      )}

      {/* Full-Width 4-Column Comparative Summary Strip */}
      <section className="grid grid-cols-1 divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="text-xs font-medium text-[#64748B]">
            Latest Verified ({periodType} · {activeTierScopeLabel})
          </div>
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
          <div className="text-xs font-medium text-[#64748B]">
            Widest Source Discrepancy ({activeTierScopeLabel})
          </div>
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
              Open full discrepancy report
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
            Across {sources.length} tracked registries &amp; outlets
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

      {/* Tier 1 Primary vs. Tier 2 Multilateral Systemic Divergence Benchmark */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <Scale className="mt-0.5 h-4 w-4 shrink-0 text-[#1E3A8A]" />
            <div>
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                Tier 1 vs. Tier 2 Divergence Benchmark
              </h2>
              <p className="text-xs text-[#64748B]">
                Compares overlapping {periodType.toLowerCase()} periods between primary registries
                (Tier 1) and multilateral agency estimates (Tier 2)
                {yearFilter !== 'All' ? ` in ${yearFilter}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {tierBenchmark && (
              <span className="font-mono text-xs tabular-nums text-[#475569] whitespace-nowrap">
                {tierBenchmark.overlappingCount} overlapping{' '}
                {periodType === 'Monthly'
                  ? tierBenchmark.overlappingCount === 1
                    ? 'month'
                    : 'months'
                  : tierBenchmark.overlappingCount === 1
                    ? 'year'
                    : 'years'}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowTier2Chart((v) => !v)}
              className="text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
            >
              {showTier2Chart ? 'Hide Tier 2 chart' : 'Show Tier 2 chart'}
            </button>
          </div>
        </div>

        {tierBenchmark ? (
          <div className="grid grid-cols-1 divide-y divide-[#F1F5F9] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <div className="px-5 py-4">
              <div className="text-[11px] font-medium text-[#64748B]">
                Tier 1 Primary Mean
              </div>
              <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#0F172A]">
                {formatNumber(tierBenchmark.tier1Avg)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B]">
                Avg. primary registry median per {periodType === 'Monthly' ? 'month' : 'year'}
              </div>
            </div>

            <div className="px-5 py-4 sm:border-l sm:border-[#F1F5F9] lg:border-l-0">
              <div className="text-[11px] font-medium text-[#64748B]">
                Tier 2 Multilateral Mean
              </div>
              <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#0F172A]">
                {formatNumber(tierBenchmark.tier2Avg)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B]">
                Avg. UN OCHA / UNFPA median across same periods
              </div>
            </div>

            <div className="px-5 py-4 sm:border-t sm:border-[#F1F5F9] lg:border-t-0">
              <div className="text-[11px] font-medium text-[#64748B]">
                Average Tier 2 − Tier 1 Delta
              </div>
              <div
                className={cn(
                  'mt-1.5 font-mono text-xl font-semibold tabular-nums',
                  tierBenchmark.avgSignedDelta > 0
                    ? 'text-[#B45309]'
                    : tierBenchmark.avgSignedDelta < 0
                      ? 'text-[#0F766E]'
                      : 'text-[#0F172A]'
                )}
              >
                {tierBenchmark.avgSignedDelta >= 0
                  ? `+${formatNumber(tierBenchmark.avgSignedDelta)}`
                  : formatNumber(tierBenchmark.avgSignedDelta)}
                <span className="ml-1.5 text-xs font-medium text-[#64748B]">
                  ({tierBenchmark.avgPctGap.toFixed(1)}% abs. gap)
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[#64748B]">
                {tierBenchmark.avgSignedDelta > 0
                  ? 'Multilateral estimates trend above primary registries'
                  : tierBenchmark.avgSignedDelta < 0
                    ? 'Multilateral estimates trend below primary registries'
                    : 'Primary and multilateral medians align closely'}
              </div>
            </div>

            <div className="px-5 py-4 sm:border-l sm:border-t sm:border-[#F1F5F9] lg:border-l-0 lg:border-t-0">
              <div className="text-[11px] font-medium text-[#64748B]">
                Peak Inter-Tier Divergence
              </div>
              <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#B45309]">
                ±{formatNumber(tierBenchmark.maxGapValue)}
              </div>
              <div className="mt-1 text-[11px] text-[#64748B]">
                {tierBenchmark.maxGapPeriod
                  ? `Observed in ${formatPeriodLabel(tierBenchmark.maxGapPeriod)}`
                  : 'Across overlapping periods'}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-5 text-xs text-[#64748B]">
            No overlapping Tier 1 primary registry and Tier 2 multilateral periods exist in the
            current {periodType.toLowerCase()} filter scope.
          </div>
        )}
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
                Periods with two or more concurrent sources ({activeTierScopeLabel})
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
                  <tr key={item.periodValue} className="transition-colors hover:bg-[#F8FAFC]">
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
                Audit trail of updated totals &amp; bulletin corrections
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

      {/* Owner Modal: Manage Historical Context Markers */}
      {isOwner && markerModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4 backdrop-blur-[1px]"
          onClick={() => setMarkerModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-markers-modal-title"
            className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-lg border border-[#E2E8F0] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#E2E8F0] px-6 py-4">
              <div>
                <h2
                  id="context-markers-modal-title"
                  className="font-serif text-lg font-semibold text-[#0F172A]"
                >
                  Historical Context Markers
                </h2>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  Add custom monthly annotations alongside the curated observatory timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarkerModalOpen(false)}
                aria-label="Close context markers dialog"
                className="rounded p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {markerError && (
                <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
                  {markerError}
                </div>
              )}

              {/* Add Custom Marker Form */}
              <form
                onSubmit={handleCreateMarker}
                className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] p-4"
              >
                <div className="text-xs font-semibold text-[#0F172A]">
                  Add Custom Monthly Marker
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#475569]">
                      Month (YYYY-MM)
                    </label>
                    <input
                      type="month"
                      required
                      value={markerPeriod}
                      onChange={(e) => setMarkerPeriod(e.target.value)}
                      className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#475569]">
                      Category
                    </label>
                    <select
                      value={markerCategory}
                      onChange={(e) =>
                        setMarkerCategory(e.target.value as ContextMarkerCategory)
                      }
                      className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                    >
                      {MARKER_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#475569]">
                    Milestone Label
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={markerTitle}
                    onChange={(e) => setMarkerTitle(e.target.value)}
                    placeholder="e.g., Northern Hospital Registry Reopened"
                    className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#475569]">
                    Context Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={markerNotes}
                    onChange={(e) => setMarkerNotes(e.target.value)}
                    placeholder="Brief explanation of how this event affected reporting coverage or registration volume..."
                    className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={markerSubmitting}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {markerSubmitting ? 'Saving...' : 'Add Marker'}
                  </button>
                </div>
              </form>

              {/* Existing Markers List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0F172A]">
                  <span>Active Timeline Markers ({contextMarkers.length})</span>
                  <span className="text-[11px] font-normal text-[#64748B]">
                    Curated entries are fixed; custom markers can be deleted
                  </span>
                </div>

                <div className="divide-y divide-[#F1F5F9] rounded-md border border-[#E2E8F0]">
                  {contextMarkers.map((marker) => {
                    const color = getMarkerStrokeColor(marker.category);
                    return (
                      <div
                        key={marker.id}
                        className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-mono text-[11px] font-semibold text-[#0F172A]">
                              {formatPeriodLabel(marker.periodValue)}
                            </span>
                            <span className="font-medium text-[#0F172A]">{marker.title}</span>
                            <span className="text-[11px] text-[#64748B]">
                              · {marker.category} · {marker.isBuiltIn ? 'Curated' : 'Custom'}
                            </span>
                          </div>
                          {marker.notes && (
                            <p className="mt-1 text-[11px] leading-relaxed text-[#475569]">
                              {marker.notes}
                            </p>
                          )}
                        </div>

                        {!marker.isBuiltIn && typeof marker.dbId === 'number' && (
                          <button
                            type="button"
                            disabled={deletingMarkerId === marker.dbId}
                            onClick={() => handleDeleteMarker(marker.dbId!)}
                            aria-label={`Delete ${marker.title}`}
                            className="rounded p-1.5 text-[#64748B] hover:bg-[#FEF2F2] hover:text-[#B91C1C] disabled:opacity-50 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
