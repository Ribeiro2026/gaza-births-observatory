import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { cn, formatNumber } from '../lib/utils';
import type { PeriodType } from '../types/observatory';

type DataQualityTrend = 'Improving' | 'Stable' | 'Diverging' | 'Mixed';

interface AnalyzedPeriodDigest {
  periodValue: string;
  periodLabel: string;
  periodType: PeriodType;
  severity: 'High' | 'Moderate' | 'Low';
  spread: number;
  spreadPct: number;
  pubSpanDays: number;
  sourceCount: number;
  flags: string[];
  topReportId: number;
}

interface DiscrepancyInsightsResponse {
  sentences: [string, string, string];
  summary: string;
  qualityTrend: DataQualityTrend;
  periodScope: 'All' | PeriodType;
  windowCount: number;
  analyzedCount: number;
  periodRangeLabel: string;
  highSeverityCount: number;
  avgSpreadPct: number;
  avgPubSpanDays: number;
  widestCase: {
    periodValue: string;
    periodLabel: string;
    spread: number;
    spreadPct: number;
    minSource: string;
    maxSource: string;
    reportId: number;
  } | null;
  analyzedPeriods: AnalyzedPeriodDigest[];
  generatedAt: string;
  cached: boolean;
  model: string;
}

interface AiDiscrepancyInsightsWidgetProps {
  periodScope?: 'All' | PeriodType;
  reportsLoaded: boolean;
  reportCount: number;
  onInspectReport?: (reportId: number) => void;
  onOpenDiscrepancyReport?: () => void;
}

const WINDOW_OPTIONS = [4, 6, 12] as const;

function getTrendColorClass(trend: DataQualityTrend): string {
  switch (trend) {
    case 'Improving':
      return 'text-[#15803D]';
    case 'Diverging':
      return 'text-[#B91C1C]';
    case 'Stable':
      return 'text-[#0F766E]';
    case 'Mixed':
    default:
      return 'text-[#B45309]';
  }
}

function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AiDiscrepancyInsightsWidget({
  periodScope = 'Monthly',
  reportsLoaded,
  reportCount,
  onInspectReport,
  onOpenDiscrepancyReport,
}: AiDiscrepancyInsightsWidgetProps) {
  const [windowCount, setWindowCount] = useState<(typeof WINDOW_OPTIONS)[number]>(6);
  const [insight, setInsight] = useState<DiscrepancyInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef(0);

  const fetchInsights = useCallback(
    async (forceRefresh = false) => {
      if (!reportsLoaded || reportCount === 0) return;
      const reqId = ++activeRequestRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/ai/discrepancy-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            periodScope,
            windowCount,
            forceRefresh,
          }),
        });

        const data = await res.json().catch(() => null);
        if (reqId !== activeRequestRef.current) return;

        if (!res.ok) {
          throw new Error(
            data?.error || `Failed to generate AI insights (HTTP ${res.status}).`
          );
        }

        setInsight(data as DiscrepancyInsightsResponse);
      } catch (err: unknown) {
        if (reqId !== activeRequestRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to generate AI discrepancy insights right now.'
        );
      } finally {
        if (reqId === activeRequestRef.current) {
          setLoading(false);
        }
      }
    },
    [periodScope, windowCount, reportsLoaded, reportCount]
  );

  useEffect(() => {
    if (reportsLoaded && reportCount > 0) {
      fetchInsights(false);
    }
  }, [fetchInsights, reportsLoaded, reportCount]);

  return (
    <section
      aria-label="AI Insights executive summary"
      className="rounded-lg border border-[#E2E8F0] bg-white"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#1E3A8A]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                AI Insights
              </h2>
              {insight && !loading && (
                <span
                  className={cn(
                    'text-xs font-medium',
                    getTrendColorClass(insight.qualityTrend)
                  )}
                >
                  · Data quality trend: {insight.qualityTrend}
                </span>
              )}
            </div>
            <p className="text-xs text-[#64748B]">
              3-sentence executive summary of data quality trends across recent{' '}
              {periodScope === 'All' ? '' : `${periodScope.toLowerCase()} `}discrepancy reports
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Window Size Selector */}
          <div
            className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
            role="group"
            aria-label="Recent discrepancy window"
          >
            {WINDOW_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                disabled={loading}
                onClick={() => setWindowCount(count)}
                className={cn(
                  'rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60',
                  windowCount === count
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                Last {count}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchInsights(true)}
            disabled={loading || !reportsLoaded || reportCount === 0}
            title="Regenerate executive summary from live discrepancy records"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-[#1E3A8A]', loading && 'animate-spin')} />
            <span>{loading ? 'Analyzing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Executive Summary Body */}
      <div className="px-5 py-4">
        {loading && !insight ? (
          <div className="space-y-2.5 border-l-2 border-[#CBD5E1] pl-4 py-0.5">
            <div className="h-3.5 w-[96%] animate-pulse rounded bg-[#F1F5F9]" />
            <div className="h-3.5 w-[92%] animate-pulse rounded bg-[#F1F5F9]" />
            <div className="h-3.5 w-[78%] animate-pulse rounded bg-[#F1F5F9]" />
            <div className="pt-1 text-[11px] text-[#64748B]">
              Auditing recent multi-source discrepancies and revision logs...
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">AI discrepancy summary unavailable</div>
                <div className="mt-0.5 text-[#7F1D1D]">{error}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchInsights(true)}
              className="rounded border border-[#FCA5A5] bg-white px-2.5 py-1 text-xs font-medium text-[#991B1B] hover:bg-[#FEF2F2] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : insight ? (
          <div
            className={cn(
              'border-l-2 border-[#1E3A8A] pl-4 transition-opacity',
              loading && 'opacity-60'
            )}
          >
            <p className="text-[14px] leading-[1.7] text-[#0F172A]">
              {insight.sentences.join(' ')}
            </p>
          </div>
        ) : (
          <div className="text-xs text-[#64748B]">
            Waiting for observatory records to load before running discrepancy analysis.
          </div>
        )}
      </div>

      {/* Grounding Metrics & Provenance Footer */}
      {insight && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[#F1F5F9] bg-[#FAFAFA] px-5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[#475569]">
            <div>
              <span className="text-[#64748B]">Window:</span>{' '}
              <span className="font-mono font-medium text-[#0F172A]">
                {insight.periodRangeLabel}
              </span>{' '}
              <span className="text-[#64748B]">
                ({insight.analyzedCount} flagged)
              </span>
            </div>

            <div>
              <span className="text-[#64748B]">High Severity:</span>{' '}
              <span
                className={cn(
                  'font-mono font-semibold tabular-nums',
                  insight.highSeverityCount > 0 ? 'text-[#B91C1C]' : 'text-[#0F172A]'
                )}
              >
                {insight.highSeverityCount}/{insight.analyzedCount}
              </span>
            </div>

            <div>
              <span className="text-[#64748B]">Mean Spread:</span>{' '}
              <span className="font-mono font-medium tabular-nums text-[#B45309]">
                {insight.avgSpreadPct.toFixed(1)}%
              </span>
            </div>

            <div>
              <span className="text-[#64748B]">Avg. Pub Lag:</span>{' '}
              <span className="font-mono font-medium tabular-nums text-[#0F172A]">
                {formatNumber(insight.avgPubSpanDays)}d
              </span>
            </div>

            {insight.widestCase && onInspectReport && (
              <button
                type="button"
                onClick={() => onInspectReport(insight.widestCase!.reportId)}
                className="text-[#1E3A8A] hover:underline cursor-pointer"
              >
                Peak: {insight.widestCase.periodLabel} (±{formatNumber(insight.widestCase.spread)})
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] text-[#64748B] shrink-0">
            <span className="font-mono">
              Updated {formatTimeOnly(insight.generatedAt)}
            </span>
            {onOpenDiscrepancyReport && (
              <button
                type="button"
                onClick={onOpenDiscrepancyReport}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
              >
                Full discrepancy audit
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
