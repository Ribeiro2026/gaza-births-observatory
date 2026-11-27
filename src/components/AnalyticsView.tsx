import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  History,
  Layers,
  LineChart as LineChartIcon,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import {
  cn,
  formatDateShort,
  formatNumber,
  formatPeriodLabel,
} from '../lib/utils';
import type {
  BirthReportRecord,
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
  pendingStagingCount: number;
  isOwner: boolean;
  loading: boolean;
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
  const [showTier2Chart, setShowTier2Chart] = useState(false);
  const [showTier3Chart, setShowTier3Chart] = useState(false);
  const [showProjection, setShowProjection] = useState(false);
  const [monthlyHorizon, setMonthlyHorizon] = useState<(typeof MONTHLY_HORIZONS)[number]>(6);
  const [yearlyHorizon, setYearlyHorizon] = useState<(typeof YEARLY_HORIZONS)[number]>(2);

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

  // Reports visible across currently enabled tier charts (drives KPI strip & Period Discrepancy Matrix)
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

  const activeHorizon = periodType === 'Monthly' ? monthlyHorizon : yearlyHorizon;

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

  return (
    <div className="space-y-8">
      {/* Editorial Section Intro */}
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

        {/* Row 2: Optional Tier 2 / Tier 3 Charts & Optional Trend Projection */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-[#FAFAFA] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748B] whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 text-[#64748B]" />
              Additional Tier Charts:
            </span>

            <button
              type="button"
              aria-pressed={showTier2Chart}
              onClick={() => setShowTier2Chart((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
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
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                showTier3Chart
                  ? 'border-[#1E3A8A] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <span>Tier 3 — Media / Secondary</span>
              <span className="font-mono text-[10px] opacity-75">
                {showTier3Chart ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* Optional Trend Projection Toggle + Selectable Horizon */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={showProjection}
              onClick={() => setShowProjection((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40',
                showProjection
                  ? 'border-[#1E3A8A] bg-[#EFF6FF] text-[#1E3A8A]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              )}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Trend Projection
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
    </div>
  );
}
