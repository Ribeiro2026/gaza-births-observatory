import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  ExternalLink,
  History,
  PenLine,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  cn,
  formatDateShort,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
  isSafeHttpUrl,
} from '../lib/utils';
import type {
  BirthReportRecord,
  ConfidenceStatus,
  PeriodType,
  SourceRecord,
  SourceType,
} from '../types/observatory';

import { matchesReportQuery } from './HeaderReportSearch';

interface DataExplorerViewProps {
  reports: BirthReportRecord[];
  sources: SourceRecord[];
  isOwner: boolean;
  loading: boolean;
  initialSourceId?: number | null;
  initialSearchQuery?: string;
  searchSyncNonce?: number;
  onClearInitialSource?: () => void;
  onClearInitialSearch?: () => void;
  onInspectReport: (reportId: number) => void;
  onOpenNewReport: () => void;
  onOpenOverride: (report: BirthReportRecord) => void;
}

type SortField = 'periodValue' | 'count' | 'publicationDate' | 'sourceName';

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function DataExplorerView({
  reports,
  sources,
  isOwner,
  loading,
  initialSourceId,
  initialSearchQuery,
  searchSyncNonce,
  onClearInitialSource,
  onClearInitialSearch,
  onInspectReport,
  onOpenNewReport,
  onOpenOverride,
}: DataExplorerViewProps) {
  const [search, setSearch] = useState(initialSearchQuery || '');
  const [periodType, setPeriodType] = useState<'All' | PeriodType>('All');
  const [year, setYear] = useState('All');
  const [month, setMonth] = useState('All');
  const [sourceType, setSourceType] = useState<'All' | SourceType>('All');
  const [sourceId, setSourceId] = useState<string>(
    initialSourceId ? String(initialSourceId) : 'All'
  );
  const [status, setStatus] = useState<'All' | ConfidenceStatus>('All');
  const [publishedFrom, setPublishedFrom] = useState('');
  const [publishedTo, setPublishedTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('periodValue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Keep source filter synchronized when clicking from Sources directory
  React.useEffect(() => {
    if (initialSourceId) {
      setSourceId(String(initialSourceId));
    }
  }, [initialSourceId]);

  // Synchronize search query when submitted from the global header search bar
  React.useEffect(() => {
    if (searchSyncNonce && initialSearchQuery !== undefined) {
      setSearch(initialSearchQuery);
      setSourceId('All');
      setPeriodType('All');
      setYear('All');
      setMonth('All');
      setSourceType('All');
      setStatus('All');
      setPublishedFrom('');
      setPublishedTo('');
    }
  }, [initialSearchQuery, searchSyncNonce]);

  const availableYears = useMemo(() => {
    const yrs = new Set(reports.map((r) => r.periodValue.slice(0, 4)));
    return Array.from(yrs).sort().reverse();
  }, [reports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports
      .filter((r) => {
        if (periodType !== 'All' && r.periodType !== periodType) return false;
        if (year !== 'All' && !r.periodValue.startsWith(year)) return false;
        if (month !== 'All' && !r.periodValue.endsWith(`-${month}`)) return false;
        if (sourceType !== 'All' && r.sourceType !== sourceType) return false;
        if (sourceId !== 'All' && r.sourceId !== Number(sourceId)) return false;
        if (status !== 'All' && r.confidenceStatus !== status) return false;
        if (publishedFrom) {
          const fromMs = new Date(publishedFrom).getTime();
          if (new Date(r.publicationDate).getTime() < fromMs) return false;
        }
        if (publishedTo) {
          const toDate = new Date(publishedTo);
          toDate.setHours(23, 59, 59, 999);
          if (new Date(r.publicationDate).getTime() > toDate.getTime()) return false;
        }
        if (q && !matchesReportQuery(r, q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'count') {
          cmp = a.count - b.count;
        } else if (sortField === 'publicationDate') {
          cmp = new Date(a.publicationDate).getTime() - new Date(b.publicationDate).getTime();
        } else if (sortField === 'sourceName') {
          cmp = a.sourceName.localeCompare(b.sourceName);
        } else {
          cmp = a.periodValue.localeCompare(b.periodValue);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [
    reports,
    periodType,
    year,
    month,
    sourceType,
    sourceId,
    status,
    publishedFrom,
    publishedTo,
    search,
    sortField,
    sortDir,
  ]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const resetFilters = () => {
    setSearch('');
    setPeriodType('All');
    setYear('All');
    setMonth('All');
    setSourceType('All');
    setSourceId('All');
    setStatus('All');
    setPublishedFrom('');
    setPublishedTo('');
    onClearInitialSource?.();
    onClearInitialSearch?.();
  };

  const hasActiveFilters =
    Boolean(search) ||
    periodType !== 'All' ||
    year !== 'All' ||
    month !== 'All' ||
    sourceType !== 'All' ||
    sourceId !== 'All' ||
    status !== 'All' ||
    Boolean(publishedFrom) ||
    Boolean(publishedTo);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Data Explorer & Provenance Ledger
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            Filter individual birth reports by period, source agency, publication window, and
            verification status. Click any row to open the full quote and revision diff.
          </p>
        </div>

        {isOwner && (
          <button
            type="button"
            onClick={onOpenNewReport}
            className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#172D6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Log Manual Report
          </button>
        )}
      </div>

      {/* Multi-Facet Filter Bar */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search quotes, document refs, sources..."
              className="w-full rounded-md border border-[#CBD5E1] bg-white py-2 pl-8 pr-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
            />
          </div>

          <select
            aria-label="Period Type"
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as 'All' | PeriodType)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Granularities</option>
            <option value="Monthly">Monthly Only</option>
            <option value="Yearly">Yearly Only</option>
          </select>

          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
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
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Months</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Verification Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'All' | ConfidenceStatus)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Statuses</option>
            <option value="Verified">Verified</option>
            <option value="Pending Review">Pending Review</option>
            <option value="Disputed">Disputed</option>
            <option value="Superseded">Superseded</option>
          </select>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[#F1F5F9] pt-3 sm:grid-cols-2 lg:grid-cols-6">
          <select
            aria-label="Source Type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as 'All' | SourceType)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Source Types</option>
            <option value="Government">Government</option>
            <option value="Multilateral Agency">Multilateral Agency</option>
            <option value="News Media">News Media</option>
            <option value="Social Media Channel">Social Media Channel</option>
          </select>

          <select
            aria-label="Specific Source"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
          >
            <option value="All">All Publishers</option>
            {sources.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="shrink-0">Published from</span>
            <input
              type="date"
              value={publishedFrom}
              onChange={(e) => setPublishedFrom(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-2 py-1.5 font-mono text-[11px] text-[#0F172A]"
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="shrink-0">to</span>
            <input
              type="date"
              value={publishedTo}
              onChange={(e) => setPublishedTo(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-2 py-1.5 font-mono text-[11px] text-[#0F172A]"
            />
          </label>

          <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:justify-end">
            <span className="font-mono text-xs tabular-nums text-[#64748B]">
              {filtered.length} of {reports.length} records
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      {/* High-Density Data Grid */}
      <section className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#FAFAFA] text-[#475569]">
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('periodValue')}
                    className="inline-flex items-center gap-1 hover:text-[#0F172A] cursor-pointer"
                  >
                    Period
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('sourceName')}
                    className="inline-flex items-center gap-1 hover:text-[#0F172A] cursor-pointer"
                  >
                    Source & Classification
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('count')}
                    className="inline-flex items-center gap-1 hover:text-[#0F172A] cursor-pointer"
                  >
                    Reported Births
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Document Ref</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('publicationDate')}
                    className="inline-flex items-center gap-1 hover:text-[#0F172A] cursor-pointer"
                  >
                    Published
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {isOwner ? 'Actions' : 'Source'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-5 w-full animate-pulse rounded bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="text-sm font-medium text-[#0F172A]">
                      No birth reports match these filter criteria.
                    </p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      {isOwner
                        ? 'Try clearing your search or logging a new verified bulletin.'
                        : 'Try clearing or broadening your search filters.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onInspectReport(row.id)}
                    className="cursor-pointer transition-colors hover:bg-[#F8FAFC]"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono font-medium text-[#0F172A]">
                        {formatPeriodLabel(row.periodValue)}
                      </div>
                      <div className="text-[11px] text-[#64748B]">{row.periodType}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-[#0F172A]">
                        <span
                          className="h-[3px] w-3 shrink-0"
                          style={{ backgroundColor: row.sourceColor }}
                        />
                        <span>{row.sourceName}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#64748B]">
                        {row.sourceType} · {row.sourceCredibilityTier}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-[#0F172A] whitespace-nowrap">
                      {formatNumber(row.count)}
                      {row.revisionCount > 0 && (
                        <div className="mt-0.5 inline-flex items-center gap-1 font-sans text-[11px] font-normal text-[#1E3A8A]">
                          <History className="h-3 w-3" />
                          {row.revisionCount} {row.revisionCount === 1 ? 'rev' : 'revs'}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          getStatusTextClass(row.confidenceStatus)
                        )}
                      >
                        {row.confidenceStatus}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono text-[11px] text-[#334155]">
                        {row.documentRef}
                      </div>
                      <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-[#64748B]">
                        {row.rawTextSnippet}
                      </p>
                    </td>

                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-[#475569] whitespace-nowrap">
                      {formatDateShort(row.publicationDate)}
                    </td>

                    <td
                      className="px-4 py-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-2">
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => onOpenOverride(row)}
                            className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] cursor-pointer"
                          >
                            <PenLine className="h-3 w-3" />
                            Override
                          </button>
                        )}
                        {isSafeHttpUrl(row.sourceUrl) && (
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open external source URL"
                            className="inline-flex items-center justify-center rounded border border-[#E2E8F0] p-1.5 text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
