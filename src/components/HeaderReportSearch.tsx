import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, History, Search, X } from 'lucide-react';
import {
  cn,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
} from '../lib/utils';
import type { BirthReportRecord } from '../types/observatory';

interface HeaderReportSearchProps {
  reports: BirthReportRecord[];
  loading: boolean;
  onSelectReport: (reportId: number) => void;
  onViewAllInExplorer: (query: string) => void;
}

const MAX_PREVIEW_RESULTS = 8;

interface RankedReport {
  report: BirthReportRecord;
  score: number;
  periodLabel: string;
}

export function matchesReportQuery(report: BirthReportRecord, rawQuery: string): boolean {
  const tokens = rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const periodLabel = formatPeriodLabel(report.periodValue).toLowerCase();
  const formattedCount = formatNumber(report.count).toLowerCase();
  const haystack = [
    report.sourceName,
    report.sourceType,
    report.sourceCredibilityTier,
    report.periodValue,
    periodLabel,
    report.periodType,
    report.documentRef,
    report.confidenceStatus,
    report.rawTextSnippet,
    String(report.count),
    formattedCount,
  ]
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

function scoreReportMatch(report: BirthReportRecord, rawQuery: string): RankedReport | null {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return null;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const periodLabel = formatPeriodLabel(report.periodValue);
  const sourceLower = report.sourceName.toLowerCase();
  const refLower = report.documentRef.toLowerCase();
  const periodLower = report.periodValue.toLowerCase();
  const periodLabelLower = periodLabel.toLowerCase();
  const statusLower = report.confidenceStatus.toLowerCase();
  const typeLower = report.sourceType.toLowerCase();
  const tierLower = report.sourceCredibilityTier.toLowerCase();
  const snippetLower = report.rawTextSnippet.toLowerCase();
  const countStr = String(report.count);
  const formattedCount = formatNumber(report.count).toLowerCase();

  const fullHaystack = `${sourceLower} ${typeLower} ${tierLower} ${periodLower} ${periodLabelLower} ${report.periodType.toLowerCase()} ${refLower} ${statusLower} ${snippetLower} ${countStr} ${formattedCount}`;

  for (const token of tokens) {
    if (!fullHaystack.includes(token)) {
      return null;
    }
  }

  let score = 0;

  if (sourceLower === normalized || refLower === normalized || periodLower === normalized) {
    score += 120;
  } else if (
    sourceLower.startsWith(normalized) ||
    refLower.startsWith(normalized) ||
    periodLower.startsWith(normalized) ||
    periodLabelLower.startsWith(normalized)
  ) {
    score += 80;
  }

  for (const token of tokens) {
    if (sourceLower.startsWith(token)) score += 32;
    else if (sourceLower.includes(token)) score += 22;

    if (refLower.includes(token)) score += 26;
    if (periodLower.includes(token) || periodLabelLower.includes(token)) score += 24;
    if (statusLower.includes(token)) score += 16;
    if (typeLower.includes(token) || tierLower.includes(token)) score += 12;
    if (countStr === token || formattedCount === token) score += 20;
    else if (countStr.includes(token)) score += 10;
    if (snippetLower.includes(token)) score += 8;
  }

  return { report, score, periodLabel };
}

export function HeaderReportSearch({
  reports,
  loading,
  onSelectReport,
  onViewAllInExplorer,
}: HeaderReportSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { previewMatches, totalMatches } = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return { previewMatches: [] as RankedReport[], totalMatches: 0 };
    }

    const ranked: RankedReport[] = [];
    for (const report of reports) {
      const match = scoreReportMatch(report, trimmed);
      if (match) ranked.push(match);
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const periodCmp = b.report.periodValue.localeCompare(a.report.periodValue);
      if (periodCmp !== 0) return periodCmp;
      return (
        new Date(b.report.publicationDate).getTime() -
        new Date(a.report.publicationDate).getTime()
      );
    });

    return {
      previewMatches: ranked.slice(0, MAX_PREVIEW_RESULTS),
      totalMatches: ranked.length,
    };
  }, [reports, query]);

  // Reset highlighted option whenever query changes
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  // Global keyboard shortcuts: "/" or Cmd/Ctrl+K focuses header search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        if (query.trim()) setIsOpen(true);
        return;
      }

      if (e.key === '/' && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        if (query.trim()) setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const showDropdown = isOpen && query.trim().length > 0;
  const hasFooterAction = totalMatches > 0;
  const selectableCount = previewMatches.length + (hasFooterAction ? 1 : 0);

  const handleSelectReport = (reportId: number) => {
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
    onSelectReport(reportId);
  };

  const handleSubmitToExplorer = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
    onViewAllInExplorer(trimmed);
  };

  const handleClear = () => {
    setQuery('');
    setActiveIndex(-1);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        e.preventDefault();
        setQuery('');
      }
      inputRef.current?.blur();
      return;
    }

    if (!showDropdown) {
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        handleSubmitToExplorer();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectableCount > 0) {
        setActiveIndex((prev) => (prev + 1) % selectableCount);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectableCount > 0) {
        setActiveIndex((prev) => (prev <= 0 ? selectableCount - 1 : prev - 1));
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < previewMatches.length) {
        handleSelectReport(previewMatches[activeIndex].report.id);
      } else {
        handleSubmitToExplorer();
      }
    }
  };

  const activeDescendantId =
    showDropdown && activeIndex >= 0
      ? activeIndex < previewMatches.length
        ? `header-search-option-${previewMatches[activeIndex].report.id}`
        : 'header-search-view-all'
      : undefined;

  return (
    <div ref={containerRef} className="relative w-full max-w-[380px] min-w-0">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#64748B]" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search birth reports by source name, period, document reference, status, or quote"
          aria-expanded={showDropdown}
          aria-controls="header-report-search-listbox"
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(e.target.value.trim().length > 0);
          }}
          onFocus={() => {
            setIsFocused(true);
            if (query.trim().length > 0) setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Search reports, sources, periods, refs..."
          className="h-9 w-full rounded-md border border-[#CBD5E1] bg-[#F8FAFC] pl-8.5 pr-12 text-xs text-[#0F172A] placeholder:text-[#64748B] transition-colors focus:border-[#1E3A8A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
        />

        {query ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search query"
            className="absolute right-2 rounded p-1 text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          !isFocused && (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 hidden rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#64748B] sm:inline-block"
            >
              /
            </kbd>
          )
        )}
      </div>

      {/* Instant Results Popover */}
      {showDropdown && (
        <div
          id="header-report-search-listbox"
          role="listbox"
          aria-label="Matching birth reports"
          className="absolute right-0 left-0 z-50 mt-1.5 w-full min-w-[300px] sm:min-w-[440px] sm:left-auto rounded-lg border border-[#CBD5E1] bg-white shadow-lg overflow-hidden"
        >
          {/* Result Summary Header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#FAFAFA] px-3.5 py-2 text-[11px] text-[#64748B]">
            <span className="font-mono tabular-nums">
              {loading
                ? 'Loading birth reports...'
                : totalMatches === 0
                  ? '0 matching reports'
                  : totalMatches <= MAX_PREVIEW_RESULTS
                    ? `${totalMatches} matching ${totalMatches === 1 ? 'report' : 'reports'}`
                    : `Showing ${previewMatches.length} of ${formatNumber(totalMatches)} matching reports`}
            </span>
            <span className="hidden sm:inline text-[11px] text-[#64748B]">
              Click to inspect · Enter for ledger
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 p-3.5">
              <div className="h-10 animate-pulse rounded bg-[#F1F5F9]" />
              <div className="h-10 animate-pulse rounded bg-[#F1F5F9]" />
            </div>
          ) : totalMatches === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs font-medium text-[#0F172A]">
                No birth reports match “{query.trim()}”
              </p>
              <p className="mt-1 text-[11px] text-[#64748B]">
                Try a publisher name (MOH, OCHA, UNFPA), period (2025-06, Aug 2026), status, or
                document reference.
              </p>
              <button
                type="button"
                onClick={handleClear}
                className="mt-3 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-[360px] divide-y divide-[#F1F5F9] overflow-y-auto">
                {previewMatches.map(({ report, periodLabel }, index) => {
                  const isActive = activeIndex === index;
                  return (
                    <button
                      key={report.id}
                      id={`header-search-option-${report.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleSelectReport(report.id)}
                      className={cn(
                        'block w-full px-3.5 py-2.5 text-left transition-colors cursor-pointer',
                        isActive ? 'bg-[#F1F5F9]' : 'bg-white hover:bg-[#F8FAFC]'
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 text-xs">
                          <span
                            className="h-[3px] w-3 shrink-0"
                            style={{ backgroundColor: report.sourceColor }}
                          />
                          <span className="truncate font-medium text-[#0F172A]">
                            {report.sourceName}
                          </span>
                          <span className="text-[#CBD5E1]" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-[11px] text-[#334155] whitespace-nowrap shrink-0">
                            {periodLabel}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-2 shrink-0">
                          <span className="font-mono text-xs font-semibold tabular-nums text-[#0F172A]">
                            {formatNumber(report.count)}
                          </span>
                          <span
                            className={cn(
                              'text-[11px] font-medium whitespace-nowrap',
                              getStatusTextClass(report.confidenceStatus)
                            )}
                          >
                            {report.confidenceStatus}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-[#64748B]">
                        <div className="min-w-0 truncate">
                          <span className="font-mono text-[#475569]">{report.documentRef}</span>
                          <span className="mx-1.5 text-[#CBD5E1]" aria-hidden="true">
                            ·
                          </span>
                          <span>{report.rawTextSnippet}</span>
                        </div>
                        {report.revisionCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#1E3A8A] whitespace-nowrap shrink-0">
                            <History className="h-2.5 w-2.5" />
                            {report.revisionCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Footer: View all matches in Data Explorer */}
              <button
                id="header-search-view-all"
                type="button"
                role="option"
                aria-selected={activeIndex === previewMatches.length}
                onMouseEnter={() => setActiveIndex(previewMatches.length)}
                onClick={handleSubmitToExplorer}
                className={cn(
                  'flex w-full items-center justify-between border-t border-[#E2E8F0] px-3.5 py-2.5 text-xs font-medium text-[#1E3A8A] transition-colors cursor-pointer',
                  activeIndex === previewMatches.length
                    ? 'bg-[#EFF6FF]'
                    : 'bg-[#FAFAFA] hover:bg-[#F1F5F9]'
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  View all {formatNumber(totalMatches)} matching{' '}
                  {totalMatches === 1 ? 'report' : 'reports'} in Data Explorer
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
                <span className="font-mono text-[10px] text-[#64748B] whitespace-nowrap">
                  Enter ↵
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
