import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  History,
  PenLine,
  RotateCcw,
} from 'lucide-react';
import {
  analyzeDiscrepancies,
  exportDiscrepanciesToCsv,
  type ConflictFlagType,
  type ConflictSeverity,
} from '../lib/discrepancy-engine';
import {
  cn,
  formatDateShort,
  formatNumber,
  getStatusTextClass,
  isSafeHttpUrl,
} from '../lib/utils';
import type { BirthReportRecord, PeriodType } from '../types/observatory';
import { AiDiscrepancyInsightsWidget } from './AiDiscrepancyInsightsWidget';

interface DiscrepancyReportViewProps {
  reports: BirthReportRecord[];
  isOwner: boolean;
  loading: boolean;
  onInspectReport: (reportId: number) => void;
  onOpenOverride: (report: BirthReportRecord) => void;
}

type ConflictFilter = 'all' | 'count-spread' | 'status-conflict' | 'pub-lag';
type SortMode = 'variance' | 'spread' | 'newest' | 'pub-lag';

function getSeverityTextClass(severity: ConflictSeverity): string {
  switch (severity) {
    case 'High':
      return 'text-[#B91C1C]';
    case 'Moderate':
      return 'text-[#B45309]';
    case 'Low':
    default:
      return 'text-[#475569]';
  }
}

export function DiscrepancyReportView({
  reports,
  isOwner,
  loading,
  onInspectReport,
  onOpenOverride,
}: DiscrepancyReportViewProps) {
  const [conflictFilter, setConflictFilter] = useState<ConflictFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<'All' | ConflictSeverity>('All');
  const [periodTypeFilter, setPeriodTypeFilter] = useState<'All' | PeriodType>('All');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [minSpreadPct, setMinSpreadPct] = useState<number>(0);
  const [includeSuperseded, setIncludeSuperseded] = useState<boolean>(false);
  const [sortMode, setSortMode] = useState<SortMode>('variance');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const audit = useMemo(
    () => analyzeDiscrepancies(reports, { includeSuperseded }),
    [reports, includeSuperseded]
  );

  const availableYears = useMemo(() => {
    const yrs = new Set(audit.cases.map((c) => c.periodValue.slice(0, 4)));
    return Array.from(yrs).sort().reverse();
  }, [audit.cases]);

  const filteredCases = useMemo(() => {
    const matches = audit.cases.filter((c) => {
      if (conflictFilter !== 'all') {
        if (conflictFilter === 'count-spread') {
          if (
            !c.flags.includes('count-spread') &&
            !c.flags.includes('duplicate-source')
          ) {
            return false;
          }
        } else if (!c.flags.includes(conflictFilter as ConflictFlagType)) {
          return false;
        }
      }
      if (severityFilter !== 'All' && c.severity !== severityFilter) return false;
      if (periodTypeFilter !== 'All' && c.periodType !== periodTypeFilter) return false;
      if (yearFilter !== 'All' && !c.periodValue.startsWith(yearFilter)) return false;
      if (minSpreadPct > 0 && c.spreadPct < minSpreadPct) return false;
      return true;
    });

    return [...matches].sort((a, b) => {
      if (sortMode === 'spread') {
        if (b.spread !== a.spread) return b.spread - a.spread;
        return b.periodValue.localeCompare(a.periodValue);
      }
      if (sortMode === 'newest') {
        const p = b.periodValue.localeCompare(a.periodValue);
        if (p !== 0) return p;
        return b.spreadPct - a.spreadPct;
      }
      if (sortMode === 'pub-lag') {
        if (b.pubSpanDays !== a.pubSpanDays) return b.pubSpanDays - a.pubSpanDays;
        return b.spreadPct - a.spreadPct;
      }
      // Default: variance %
      if (b.spreadPct !== a.spreadPct) return b.spreadPct - a.spreadPct;
      return b.periodValue.localeCompare(a.periodValue);
    });
  }, [
    audit.cases,
    conflictFilter,
    severityFilter,
    periodTypeFilter,
    yearFilter,
    minSpreadPct,
    sortMode,
  ]);

  // Expand the highest-priority visible conflict on initial data load
  useEffect(() => {
    if (filteredCases.length > 0 && expandedKeys.length === 0) {
      setExpandedKeys([filteredCases[0].key]);
    }
  }, [filteredCases, expandedKeys.length]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const allExpanded =
    filteredCases.length > 0 &&
    filteredCases.every((c) => expandedKeys.includes(c.key));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedKeys([]);
    } else {
      setExpandedKeys(filteredCases.map((c) => c.key));
    }
  };

  const hasActiveFilters =
    conflictFilter !== 'all' ||
    severityFilter !== 'All' ||
    periodTypeFilter !== 'All' ||
    yearFilter !== 'All' ||
    minSpreadPct > 0 ||
    includeSuperseded;

  const resetFilters = () => {
    setConflictFilter('all');
    setSeverityFilter('All');
    setPeriodTypeFilter('All');
    setYearFilter('All');
    setMinSpreadPct(0);
    setIncludeSuperseded(false);
  };

  const handleExportCsv = () => {
    if (filteredCases.length === 0) return;
    exportDiscrepanciesToCsv(filteredCases);
    setExportNotice(
      `Exported ${formatNumber(filteredCases.length)} flagged ${
        filteredCases.length === 1 ? 'period' : 'periods'
      } to CSV.`
    );
    setTimeout(() => setExportNotice(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Editorial Intro Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Discrepancy Report &amp; Conflict Audit
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
            Automated audit flagging periods where publishers contradict each other in reported
            birth counts, verification status, or publication timing. Expand any period to compare
            sources side by side.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || filteredCases.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#1E3A8A]" />
            Export CSV
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2.5 text-xs text-[#334155]">
          {exportNotice}
        </div>
      )}

      {/* Full-Width 4-Column Conflict Summary Strip */}
      <section className="grid grid-cols-1 divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="text-xs font-medium text-[#64748B]">Flagged Periods</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#0F172A]">
            {formatNumber(audit.totalFlaggedPeriods)}
            <span className="ml-1.5 text-sm font-normal text-[#64748B]">
              / {formatNumber(audit.totalMultiSourcePeriods)}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            <span className="font-semibold text-[#B91C1C]">
              {formatNumber(audit.highSeverityCount)} High
            </span>{' '}
            severity conflicts detected
          </div>
        </div>

        <div className="p-5 sm:border-l sm:border-[#E2E8F0] lg:border-l-0">
          <div className="text-xs font-medium text-[#64748B]">Count Spread Conflicts</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#B45309]">
            {formatNumber(audit.countSpreadCount)}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            {audit.widestSpreadCase ? (
              <>
                Peak ±{formatNumber(audit.widestSpreadCase.spread)} (
                {audit.widestSpreadCase.spreadPct.toFixed(1)}%) ·{' '}
                {audit.widestSpreadCase.periodLabel}
              </>
            ) : (
              'No conflicting birth totals'
            )}
          </div>
        </div>

        <div className="p-5 sm:border-t sm:border-[#E2E8F0] lg:border-t-0">
          <div className="text-xs font-medium text-[#64748B]">Verification Status Conflicts</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#B91C1C]">
            {formatNumber(audit.statusConflictCount)}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            Periods with Disputed or mixed status
          </div>
        </div>

        <div className="p-5 sm:border-l sm:border-t sm:border-[#E2E8F0] lg:border-l-0 lg:border-t-0">
          <div className="text-xs font-medium text-[#64748B]">Publication Lag Anomalies</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1E3A8A]">
            {formatNumber(audit.pubLagCount)}
          </div>
          <div className="mt-1.5 text-xs text-[#475569]">
            {audit.longestLagCase ? (
              <>
                Max {formatNumber(audit.longestLagCase.pubSpanDays)}d span ·{' '}
                {audit.longestLagCase.periodLabel}
              </>
            ) : (
              'All concurrent releases within window'
            )}
          </div>
        </div>
      </section>

      {/* AI Insights: Gemini 3-Sentence Executive Summary of Recent Discrepancies */}
      <AiDiscrepancyInsightsWidget
        periodScope={periodTypeFilter}
        reportsLoaded={!loading}
        reportCount={reports.length}
        onInspectReport={onInspectReport}
      />

      {/* Filter & Prioritization Toolbar */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Conflict Type Segmented Control */}
          <div
            className="inline-flex flex-wrap items-center rounded-md bg-[#F1F5F9] p-0.5"
            role="group"
            aria-label="Filter by conflict category"
          >
            {(
              [
                { id: 'all', label: 'All Conflicts' },
                { id: 'count-spread', label: 'Count Spread' },
                { id: 'status-conflict', label: 'Status Conflict' },
                { id: 'pub-lag', label: 'Publication Lag' },
              ] as Array<{ id: ConflictFilter; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setConflictFilter(opt.id)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  conflictFilter === opt.id
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#475569] cursor-pointer">
              <input
                type="checkbox"
                checked={includeSuperseded}
                onChange={(e) => setIncludeSuperseded(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#CBD5E1] accent-[#1E3A8A]"
              />
              <span className="whitespace-nowrap">Include Superseded</span>
            </label>

            <button
              type="button"
              onClick={toggleExpandAll}
              disabled={filteredCases.length === 0}
              className="text-xs font-medium text-[#1E3A8A] hover:underline disabled:opacity-40 whitespace-nowrap cursor-pointer"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-[#F1F5F9] pt-3 sm:grid-cols-2 lg:grid-cols-6">
          <select
            aria-label="Severity"
            value={severityFilter}
            onChange={(e) =>
              setSeverityFilter(e.target.value as 'All' | ConflictSeverity)
            }
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Severities</option>
            <option value="High">High Severity</option>
            <option value="Moderate">Moderate Severity</option>
            <option value="Low">Low Severity</option>
          </select>

          <select
            aria-label="Granularity"
            value={periodTypeFilter}
            onChange={(e) =>
              setPeriodTypeFilter(e.target.value as 'All' | PeriodType)
            }
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Granularities</option>
            <option value="Monthly">Monthly Only</option>
            <option value="Yearly">Yearly Only</option>
          </select>

          <select
            aria-label="Year"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Years</option>
            {availableYears.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          <select
            aria-label="Minimum variance threshold"
            value={String(minSpreadPct)}
            onChange={(e) => setMinSpreadPct(Number(e.target.value))}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="0">Any Count Variance</option>
            <option value="5">Variance ≥ 5%</option>
            <option value="10">Variance ≥ 10%</option>
            <option value="15">Variance ≥ 15%</option>
          </select>

          <select
            aria-label="Sort conflicts"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="variance">Sort: Highest Variance %</option>
            <option value="spread">Sort: Largest Birth Spread</option>
            <option value="newest">Sort: Newest Period</option>
            <option value="pub-lag">Sort: Longest Pub Lag</option>
          </select>

          <div className="flex items-center justify-between gap-2 lg:justify-end">
            <span className="font-mono text-xs tabular-nums text-[#64748B]">
              {filteredCases.length} of {audit.cases.length} flagged
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Flagged Conflict Cards with Side-by-Side Diff Tables */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-[#E2E8F0] bg-white"
            />
          ))}
        </div>
      ) : filteredCases.length === 0 ? (
        <section className="rounded-lg border border-[#E2E8F0] bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-[#0F172A]">
            No conflicting periods match the active audit filters.
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            Lower the minimum variance threshold or clear filters to inspect all flagged periods.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              Reset Audit Filters
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          {filteredCases.map((item) => {
            const isExpanded = expandedKeys.includes(item.key);
            return (
              <article
                key={item.key}
                className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white"
              >
                {/* Clickable Conflict Summary Header */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(item.key)}
                  aria-expanded={isExpanded}
                  className="flex w-full flex-col gap-3 px-5 py-4 text-left transition-colors hover:bg-[#FAFAFA] md:flex-row md:items-center md:justify-between cursor-pointer"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 text-[#64748B] shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[#1E3A8A]" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                          {item.periodLabel}
                        </h2>
                        <span className="font-mono text-[11px] text-[#64748B]">
                          {item.periodValue} · {item.periodType}
                        </span>
                        <span className="text-[#CBD5E1]" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            getSeverityTextClass(item.severity)
                          )}
                        >
                          {item.severity} Severity
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#475569]">
                        <span>{item.flagLabels.join(' · ')}</span>
                        <span className="text-[#CBD5E1]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#64748B]">
                          {item.sourceCount}{' '}
                          {item.sourceCount === 1 ? 'report' : 'reports'} ({item.statusSummary})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right-aligned Tabular Variance & Lag Metrics */}
                  <div className="flex flex-wrap items-center gap-5 pl-7 font-mono text-xs tabular-nums md:pl-0 shrink-0">
                    {item.spread > 0 && (
                      <div className="text-left md:text-right">
                        <div className="font-semibold text-[#B45309]">
                          ±{formatNumber(item.spread)} births
                        </div>
                        <div className="text-[11px] text-[#64748B]">
                          {item.spreadPct.toFixed(1)}% spread ({formatNumber(item.minReport.count)}–
                          {formatNumber(item.maxReport.count)})
                        </div>
                      </div>
                    )}

                    {item.pubSpanDays > 0 && (
                      <div className="text-left md:text-right">
                        <div
                          className={cn(
                            'font-medium',
                            item.flags.includes('pub-lag')
                              ? 'text-[#1E3A8A]'
                              : 'text-[#334155]'
                          )}
                        >
                          {formatNumber(item.pubSpanDays)}d pub span
                        </div>
                        <div className="text-[11px] text-[#64748B]">
                          {formatDateShort(item.earliestPubDate)} –{' '}
                          {formatDateShort(item.latestPubDate)}
                        </div>
                      </div>
                    )}
                  </div>
                </button>

                {/* Expanded Side-by-Side Source Diff Table */}
                {isExpanded && (
                  <div className="border-t border-[#E2E8F0]">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FAFAFA] px-5 py-2.5 text-[11px] text-[#64748B]">
                      <span>
                        Side-by-side comparison against period median:{' '}
                        <strong className="font-mono font-semibold tabular-nums text-[#0F172A]">
                          {formatNumber(item.medianCount)} births
                        </strong>
                      </span>
                      {item.duplicateSourceNames.length > 0 && (
                        <span className="font-medium text-[#B91C1C]">
                          Duplicate active rows from: {item.duplicateSourceNames.join(', ')}
                        </span>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-y border-[#E2E8F0] bg-white text-[#475569]">
                            <th className="px-5 py-2.5 font-medium">Publisher &amp; Tier</th>
                            <th className="px-4 py-2.5 text-right font-medium">
                              Reported Births &amp; Delta
                            </th>
                            <th className="px-4 py-2.5 font-medium">Status</th>
                            <th className="px-4 py-2.5 font-medium">Published &amp; Lag</th>
                            <th className="px-4 py-2.5 font-medium">Document Ref &amp; Excerpt</th>
                            <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F5F9]">
                          {item.reports.map((entry) => {
                            const { report } = entry;
                            return (
                              <tr
                                key={report.id}
                                className="transition-colors hover:bg-[#F8FAFC]"
                              >
                                <td className="px-5 py-3 align-top">
                                  <div className="flex items-center gap-2 font-medium text-[#0F172A]">
                                    <span
                                      className="h-[3px] w-3 shrink-0"
                                      style={{ backgroundColor: report.sourceColor }}
                                    />
                                    <span>{report.sourceName}</span>
                                    {entry.isDuplicateSource && (
                                      <span className="text-[11px] font-medium text-[#B91C1C]">
                                        (Duplicate)
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-[#64748B]">
                                    {report.sourceType} · {report.sourceCredibilityTier}
                                  </div>
                                </td>

                                <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                                  <div className="font-mono text-sm font-semibold tabular-nums text-[#0F172A]">
                                    {formatNumber(report.count)}
                                  </div>
                                  <div
                                    className={cn(
                                      'mt-0.5 font-mono text-[11px] tabular-nums',
                                      entry.deltaFromMedian > 0
                                        ? 'text-[#B45309]'
                                        : entry.deltaFromMedian < 0
                                          ? 'text-[#475569]'
                                          : 'text-[#64748B]'
                                    )}
                                  >
                                    {entry.deltaFromMedian === 0
                                      ? 'At median'
                                      : `${entry.deltaFromMedian > 0 ? '+' : ''}${formatNumber(
                                          entry.deltaFromMedian
                                        )} (${entry.pctFromMedian > 0 ? '+' : ''}${entry.pctFromMedian.toFixed(
                                          1
                                        )}%)`}
                                  </div>
                                  {item.spread > 0 && (
                                    <div
                                      className="ml-auto mt-1.5 h-1 w-24 rounded-full bg-[#E2E8F0] overflow-hidden"
                                      aria-hidden="true"
                                    >
                                      <div
                                        className="h-full rounded-full"
                                        style={{
                                          width: `${Math.max(
                                            8,
                                            Math.round(entry.positionRatio * 100)
                                          )}%`,
                                          backgroundColor: report.sourceColor,
                                        }}
                                      />
                                    </div>
                                  )}
                                </td>

                                <td className="px-4 py-3 align-top whitespace-nowrap">
                                  <div
                                    className={cn(
                                      'text-xs font-semibold',
                                      getStatusTextClass(report.confidenceStatus)
                                    )}
                                  >
                                    {report.confidenceStatus}
                                  </div>
                                  {report.revisionCount > 0 && (
                                    <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-[#1E3A8A]">
                                      <History className="h-3 w-3" />
                                      {report.revisionCount}{' '}
                                      {report.revisionCount === 1 ? 'rev' : 'revs'}
                                    </div>
                                  )}
                                </td>

                                <td className="px-4 py-3 align-top whitespace-nowrap">
                                  <div className="font-mono text-[11px] tabular-nums text-[#0F172A]">
                                    {formatDateShort(report.publicationDate)}
                                  </div>
                                  <div
                                    className={cn(
                                      'mt-0.5 font-mono text-[11px] tabular-nums',
                                      entry.lagFromEarliestDays >= 21
                                        ? 'font-medium text-[#1E3A8A]'
                                        : 'text-[#64748B]'
                                    )}
                                  >
                                    {entry.lagFromEarliestDays === 0
                                      ? 'Earliest release'
                                      : `+${formatNumber(entry.lagFromEarliestDays)}d later`}
                                  </div>
                                </td>

                                <td className="px-4 py-3 align-top max-w-[300px]">
                                  <div className="font-mono text-[11px] text-[#334155]">
                                    {report.documentRef}
                                  </div>
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[#64748B]">
                                    “{report.rawTextSnippet}”
                                  </p>
                                </td>

                                <td className="px-5 py-3 text-right align-top whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => onInspectReport(report.id)}
                                      className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] cursor-pointer"
                                    >
                                      <Eye className="h-3 w-3" />
                                      Inspect
                                    </button>
                                    {isOwner && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenOverride(report)}
                                        className="inline-flex items-center gap-1 rounded bg-[#1E3A8A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#172D6B] cursor-pointer"
                                      >
                                        <PenLine className="h-3 w-3" />
                                        Override
                                      </button>
                                    )}
                                    {isSafeHttpUrl(report.sourceUrl) && (
                                      <a
                                        href={report.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="Open original source URL"
                                        className="inline-flex items-center justify-center rounded border border-[#E2E8F0] p-1.5 text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
