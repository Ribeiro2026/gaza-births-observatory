import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  History,
  PenLine,
  Quote,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatReportCitation, type CitationFormat } from '../lib/citations';
import {
  cn,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatPeriodLabel,
  getStatusTextClass,
  isSafeHttpUrl,
} from '../lib/utils';
import type { BirthReportRecord, ReportDetailRecord } from '../types/observatory';

type UrlHealthStatus =
  | 'live'
  | 'redirected'
  | 'restricted'
  | 'broken'
  | 'unreachable'
  | 'archival_placeholder';

interface UrlCheckResult {
  originalUrl: string;
  finalUrl: string;
  status: UrlHealthStatus;
  statusCode: number | null;
  reachable: boolean;
  redirected: boolean;
  latencyMs: number;
  note: string;
  checkedAt: string;
}

interface GroundedWebSource {
  title: string;
  uri: string;
  domain: string;
}

interface SourceSearchVerificationResponse {
  reportId: number;
  urlCheck: UrlCheckResult;
  grounding: {
    urlVerificationSummary: string;
    realtimeContext: string;
    searchQueries: string[];
    sources: GroundedWebSource[];
    generatedAt: string;
    model: string;
  } | null;
  groundingError?: {
    status: number;
    message: string;
  } | null;
  cached: boolean;
}

interface SourceInspectorDrawerProps {
  reportId: number | null;
  isOwner: boolean;
  refreshNonce: number;
  onClose: () => void;
  onSelectReportId: (id: number) => void;
  onRequestOverride: (report: BirthReportRecord) => void;
}

function getUrlStatusMeta(status: UrlHealthStatus): {
  label: string;
  textClass: string;
  icon: 'ok' | 'warn' | 'err' | 'neutral';
} {
  switch (status) {
    case 'live':
      return { label: 'Live', textClass: 'text-[#15803D]', icon: 'ok' };
    case 'redirected':
      return { label: 'Redirected', textClass: 'text-[#0F766E]', icon: 'ok' };
    case 'restricted':
      return { label: 'Restricted Access', textClass: 'text-[#B45309]', icon: 'warn' };
    case 'broken':
      return { label: 'Broken / Missing', textClass: 'text-[#B91C1C]', icon: 'err' };
    case 'unreachable':
      return { label: 'Unreachable', textClass: 'text-[#B91C1C]', icon: 'err' };
    case 'archival_placeholder':
    default:
      return { label: 'Archival Placeholder', textClass: 'text-[#64748B]', icon: 'neutral' };
  }
}

export function SourceInspectorDrawer({
  reportId,
  isOwner,
  refreshNonce,
  onClose,
  onSelectReportId,
  onRequestOverride,
}: SourceInspectorDrawerProps) {
  const [detail, setDetail] = useState<ReportDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citationFormat, setCitationFormat] = useState<CitationFormat>('apa');
  const [citationCopied, setCitationCopied] = useState(false);

  // Per-report live URL & Google Search grounding cache during drawer session
  const [verificationsByReport, setVerificationsByReport] = useState<
    Record<number, SourceSearchVerificationResponse>
  >({});
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyReqCounterRef = useRef(0);

  const activeVerification = reportId ? verificationsByReport[reportId] ?? null : null;

  const formattedCitation = useMemo(
    () => (detail ? formatReportCitation(detail, citationFormat) : ''),
    [detail, citationFormat]
  );

  const handleCopyCitation = async () => {
    if (!formattedCitation) return;
    try {
      await navigator.clipboard.writeText(formattedCitation);
      setCitationCopied(true);
      setTimeout(() => setCitationCopied(false), 2200);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  const handleRunVerification = async (forceRefresh = false) => {
    if (!reportId) return;
    const targetReportId = reportId;
    const reqId = ++verifyReqCounterRef.current;
    setVerifying(true);
    setVerifyError(null);

    try {
      const res = await fetch(`/api/reports/${targetReportId}/verify-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      });

      const data = await res.json().catch(() => null);
      if (reqId !== verifyReqCounterRef.current) return;

      if (!res.ok) {
        throw new Error(
          data?.error || `Failed to verify URL and fetch search context (HTTP ${res.status}).`
        );
      }

      setVerificationsByReport((prev) => ({
        ...prev,
        [targetReportId]: data as SourceSearchVerificationResponse,
      }));
    } catch (err: unknown) {
      if (reqId !== verifyReqCounterRef.current) return;
      setVerifyError(
        err instanceof Error
          ? err.message
          : 'Unable to complete live URL and Google Search verification.'
      );
    } finally {
      if (reqId === verifyReqCounterRef.current) {
        setVerifying(false);
      }
    }
  };

  useEffect(() => {
    // Cancel any in-flight verification UI update when switching reports
    verifyReqCounterRef.current += 1;
    setVerifying(false);
    setVerifyError(null);

    if (!reportId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/reports/${reportId}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not load source details.');
        }
        return res.json();
      })
      .then((data: ReportDetailRecord) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load report.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reportId, refreshNonce]);

  if (!reportId) return null;

  const urlStatusMeta = activeVerification
    ? getUrlStatusMeta(activeVerification.urlCheck.status)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/25 transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-label="Source and Revision Inspector"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-[560px] flex-col border-l border-[#CBD5E1] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4">
          <div>
            <div className="text-xs text-[#64748B]">
              Source Provenance &amp; Revision Inspector
            </div>
            <h2 className="mt-0.5 font-serif text-xl font-semibold text-[#0F172A]">
              {detail
                ? `${detail.sourceName} · ${formatPeriodLabel(detail.periodValue)}`
                : 'Loading record...'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-md p-1.5 text-[#475569] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="h-16 animate-pulse rounded bg-[#F1F5F9]" />
              <div className="h-28 animate-pulse rounded bg-[#F1F5F9]" />
              <div className="h-40 animate-pulse rounded bg-[#F1F5F9]" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]">
              {error}
            </div>
          ) : detail ? (
            <>
              {/* Hero Metric & Status Row */}
              <div className="flex items-baseline justify-between gap-4 border-b border-[#E2E8F0] pb-5">
                <div>
                  <div className="text-xs text-[#64748B]">
                    Reported Live Births ({detail.periodType})
                  </div>
                  <div className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[#0F172A]">
                    {formatNumber(detail.count)}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      'text-xs font-semibold',
                      getStatusTextClass(detail.confidenceStatus)
                    )}
                  >
                    {detail.confidenceStatus}
                  </div>
                  <div className="mt-1 text-xs text-[#64748B]">
                    {detail.sourceCredibilityTier}
                  </div>
                </div>
              </div>

              {/* Verbatim Quote */}
              <div>
                <h3 className="text-xs font-semibold text-[#0F172A]">
                  Archived Verbatim Excerpt
                </h3>
                <blockquote className="mt-2 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] p-4 font-serif text-sm italic leading-relaxed text-[#1E293B]">
                  “{detail.rawTextSnippet}”
                </blockquote>
              </div>

              {/* Provenance Metadata Grid */}
              <div>
                <h3 className="text-xs font-semibold text-[#0F172A]">
                  Archival Provenance
                </h3>
                <dl className="mt-2 divide-y divide-[#F1F5F9] border-y border-[#E2E8F0] text-xs">
                  <div className="grid grid-cols-3 gap-2 py-2.5">
                    <dt className="text-[#64748B]">Document Ref</dt>
                    <dd className="col-span-2 font-mono text-[#0F172A]">{detail.documentRef}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-2.5">
                    <dt className="text-[#64748B]">Source Type</dt>
                    <dd className="col-span-2 text-[#0F172A]">{detail.sourceType}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-2.5">
                    <dt className="text-[#64748B]">Published</dt>
                    <dd className="col-span-2 font-mono tabular-nums text-[#0F172A]">
                      {formatDateTime(detail.publicationDate)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-2.5">
                    <dt className="text-[#64748B]">Archived At</dt>
                    <dd className="col-span-2 font-mono tabular-nums text-[#0F172A]">
                      {formatDateTime(detail.archivedAt)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-2.5">
                    <dt className="text-[#64748B]">Source Link</dt>
                    <dd className="col-span-2 min-w-0 space-y-1">
                      <div className="truncate">
                        {isSafeHttpUrl(detail.sourceUrl) ? (
                          <a
                            href={detail.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-[#1E3A8A] hover:underline"
                          >
                            <span className="truncate">{detail.sourceUrl}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-[#64748B]">
                            {detail.sourceUrl}
                          </span>
                        )}
                      </div>
                      {activeVerification && urlStatusMeta && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <span className={cn('font-medium', urlStatusMeta.textClass)}>
                            {urlStatusMeta.label}
                          </span>
                          {activeVerification.urlCheck.statusCode !== null && (
                            <span className="font-mono text-[#64748B]">
                              HTTP {activeVerification.urlCheck.statusCode}
                            </span>
                          )}
                          {activeVerification.urlCheck.latencyMs > 0 && (
                            <span className="font-mono text-[#64748B]">
                              · {formatNumber(activeVerification.urlCheck.latencyMs)}ms
                            </span>
                          )}
                        </div>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Live URL Verification & Google Search Grounding */}
              <div className="rounded-md border border-[#E2E8F0] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] bg-[#FAFAFA] px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-[#1E3A8A]" />
                    <h3 className="text-xs font-semibold text-[#0F172A]">
                      Live URL Check &amp; Search Grounding
                    </h3>
                  </div>

                  <button
                    type="button"
                    disabled={verifying}
                    onClick={() => handleRunVerification(Boolean(activeVerification))}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60',
                      activeVerification
                        ? 'border border-[#CBD5E1] bg-white text-[#0F172A] hover:bg-[#F8FAFC]'
                        : 'bg-[#1E3A8A] text-white hover:bg-[#172D6B]'
                    )}
                  >
                    {verifying ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : activeVerification ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 text-[#1E3A8A]" />
                        <span>Re-verify</span>
                      </>
                    ) : (
                      <>
                        <Search className="h-3.5 w-3.5" />
                        <span>Verify URL &amp; Context</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {!activeVerification && !verifying && !verifyError && (
                    <p className="text-xs leading-relaxed text-[#475569]">
                      Probe the external publication URL for live reachability and query Google
                      Search grounding to retrieve real-time corroboration and demographic context
                      for {detail.sourceName} ({formatPeriodLabel(detail.periodValue)}).
                    </p>
                  )}

                  {verifying && !activeVerification && (
                    <div className="space-y-2.5">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-[#F1F5F9]" />
                      <div className="h-3 w-full animate-pulse rounded bg-[#F1F5F9]" />
                      <div className="h-3 w-5/6 animate-pulse rounded bg-[#F1F5F9]" />
                      <div className="pt-1 text-[11px] text-[#64748B]">
                        Checking external link status and querying Google Search grounding...
                      </div>
                    </div>
                  )}

                  {verifyError && (
                    <div className="flex items-start justify-between gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{verifyError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRunVerification(true)}
                        className="rounded border border-[#FCA5A5] bg-white px-2.5 py-1 text-[11px] font-medium text-[#991B1B] hover:bg-[#FEF2F2] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {activeVerification && urlStatusMeta && (
                    <div className={cn('space-y-4 transition-opacity', verifying && 'opacity-60')}>
                      {/* 1. Direct URL Probe Status */}
                      <div className="rounded-md border border-[#E2E8F0] bg-[#FAFAFA] p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-1.5 font-semibold">
                            {urlStatusMeta.icon === 'ok' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" />
                            ) : urlStatusMeta.icon === 'warn' ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-[#B45309]" />
                            ) : urlStatusMeta.icon === 'err' ? (
                              <ShieldAlert className="h-3.5 w-3.5 text-[#B91C1C]" />
                            ) : (
                              <Globe className="h-3.5 w-3.5 text-[#64748B]" />
                            )}
                            <span className={urlStatusMeta.textClass}>
                              URL Status: {urlStatusMeta.label}
                            </span>
                          </div>

                          <div className="font-mono text-[11px] tabular-nums text-[#64748B]">
                            {activeVerification.urlCheck.statusCode !== null
                              ? `HTTP ${activeVerification.urlCheck.statusCode}`
                              : 'No HTTP code'}
                            {activeVerification.urlCheck.latencyMs > 0
                              ? ` · ${formatNumber(activeVerification.urlCheck.latencyMs)}ms`
                              : ''}
                          </div>
                        </div>

                        <p className="mt-1.5 leading-relaxed text-[#334155]">
                          {activeVerification.urlCheck.note}
                        </p>

                        {activeVerification.urlCheck.redirected &&
                          isSafeHttpUrl(activeVerification.urlCheck.finalUrl) && (
                            <div className="mt-1.5 truncate text-[11px] text-[#475569]">
                              Resolved to:{' '}
                              <a
                                href={activeVerification.urlCheck.finalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[#1E3A8A] hover:underline"
                              >
                                {activeVerification.urlCheck.finalUrl}
                              </a>
                            </div>
                          )}
                      </div>

                      {/* 2. Search-Grounded URL Corroboration & Real-Time Context */}
                      {activeVerification.grounding ? (
                        <>
                          <div className="space-y-3 border-l-2 border-[#1E3A8A] pl-3.5 text-xs">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                                Web Corroboration
                              </div>
                              <p className="mt-1 leading-relaxed text-[#0F172A]">
                                {activeVerification.grounding.urlVerificationSummary}
                              </p>
                            </div>

                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
                                Real-Time Context
                              </div>
                              <p className="mt-1 leading-relaxed text-[#0F172A]">
                                {activeVerification.grounding.realtimeContext}
                              </p>
                            </div>
                          </div>

                          {/* 3. Grounded Web Sources (from Google Search groundingChunks) */}
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-semibold text-[#475569]">
                              <span>
                                Google Search Sources ({activeVerification.grounding.sources.length})
                              </span>
                              <span className="font-mono font-normal text-[#64748B]">
                                Checked {formatDateTime(activeVerification.grounding.generatedAt)}
                              </span>
                            </div>

                            {activeVerification.grounding.sources.length > 0 ? (
                              <ul className="mt-2 divide-y divide-[#F1F5F9] rounded-md border border-[#E2E8F0]">
                                {activeVerification.grounding.sources
                                  .filter((s) => isSafeHttpUrl(s.uri))
                                  .map((src) => (
                                    <li key={src.uri}>
                                      <a
                                        href={src.uri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors hover:bg-[#F8FAFC]"
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate font-medium text-[#1E3A8A] hover:underline">
                                            {src.title}
                                          </div>
                                          <div className="truncate font-mono text-[10px] text-[#64748B]">
                                            {src.domain}
                                          </div>
                                        </div>
                                        <ExternalLink className="h-3 w-3 shrink-0 text-[#64748B]" />
                                      </a>
                                    </li>
                                  ))}
                              </ul>
                            ) : (
                              <p className="mt-1.5 text-[11px] text-[#64748B]">
                                No direct web links were returned in search grounding metadata for
                                this query.
                              </p>
                            )}

                            {activeVerification.grounding.searchQueries.length > 0 && (
                              <div className="mt-2.5 text-[11px] text-[#64748B]">
                                <span className="font-medium text-[#475569]">Search queries: </span>
                                <span className="font-mono">
                                  {activeVerification.grounding.searchQueries.join(' · ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </>
                      ) : activeVerification.groundingError ? (
                        <div className="flex items-start justify-between gap-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              <div className="font-medium">
                                Google Search Grounding Temporarily Unavailable
                              </div>
                              <div className="mt-0.5 leading-relaxed">
                                {activeVerification.groundingError.message}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRunVerification(true)}
                            className="rounded border border-[#FCD34D] bg-white px-2.5 py-1 text-[11px] font-medium text-[#92400E] hover:bg-[#FEF3C7] whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {/* Citation Generator (APA / Chicago / BibTeX) */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                    <Quote className="h-3.5 w-3.5 text-[#1E3A8A]" />
                    Cite This Record
                  </h3>
                  <div
                    className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5"
                    role="group"
                    aria-label="Citation format"
                  >
                    {(
                      [
                        { id: 'apa', label: 'APA' },
                        { id: 'chicago', label: 'Chicago' },
                        { id: 'bibtex', label: 'BibTeX' },
                      ] as const
                    ).map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => {
                          setCitationFormat(fmt.id);
                          setCitationCopied(false);
                        }}
                        className={cn(
                          'rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                          citationFormat === fmt.id
                            ? 'bg-white text-[#0F172A] shadow-xs'
                            : 'text-[#475569] hover:text-[#0F172A]'
                        )}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] p-3">
                  <pre
                    className={cn(
                      'whitespace-pre-wrap break-words text-xs leading-relaxed text-[#1E293B]',
                      citationFormat === 'bibtex' ? 'font-mono text-[11px]' : 'font-sans'
                    )}
                  >
                    {formattedCitation}
                  </pre>
                  <div className="mt-2.5 flex items-center justify-end border-t border-[#E2E8F0] pt-2">
                    <button
                      type="button"
                      onClick={handleCopyCitation}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {citationCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#15803D]" />
                          Copied {citationFormat.toUpperCase()} Citation
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-[#1E3A8A]" />
                          Copy {citationFormat.toUpperCase()} Citation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Concurrent Sources for Same Period */}
              {detail.siblingReports.length > 1 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#0F172A]">
                    Other Sources Reporting {formatPeriodLabel(detail.periodValue)}
                  </h3>
                  <div className="mt-2 divide-y divide-[#F1F5F9] rounded-md border border-[#E2E8F0]">
                    {detail.siblingReports.map((sib) => {
                      const isCurrent = sib.id === detail.id;
                      const diff = sib.count - detail.count;
                      return (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={() => onSelectReportId(sib.id)}
                          className={cn(
                            'flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors cursor-pointer',
                            isCurrent ? 'bg-[#F8FAFC] font-medium' : 'hover:bg-[#FAFAFA]'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-[3px] w-3 shrink-0"
                              style={{ backgroundColor: sib.sourceColor }}
                            />
                            <span className="text-[#0F172A]">{sib.sourceName}</span>
                            {isCurrent && (
                              <span className="text-[11px] text-[#64748B]">(Inspecting)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 font-mono tabular-nums">
                            <span className="font-semibold text-[#0F172A]">
                              {formatNumber(sib.count)}
                            </span>
                            {!isCurrent && (
                              <span
                                className={cn(
                                  'text-[11px]',
                                  diff >= 0 ? 'text-[#B45309]' : 'text-[#475569]'
                                )}
                              >
                                {diff >= 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Revision History / Diff View */}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                    <History className="h-3.5 w-3.5 text-[#1E3A8A]" />
                    Revision History &amp; Diff Log
                  </h3>
                  <span className="font-mono text-[11px] text-[#64748B]">
                    {detail.revisions.length}{' '}
                    {detail.revisions.length === 1 ? 'change' : 'changes'}
                  </span>
                </div>

                {detail.revisions.length === 0 ? (
                  <p className="mt-2 rounded-md border border-[#E2E8F0] bg-[#FAFAFA] p-3.5 text-xs text-[#64748B]">
                    No revisions recorded. This observation still reflects its original published
                    figure.
                  </p>
                ) : (
                  <ol className="mt-2.5 space-y-3">
                    {detail.revisions.map((rev) => {
                      const delta = rev.newValue - rev.previousValue;
                      return (
                        <li
                          key={rev.id}
                          className="rounded-md border border-[#E2E8F0] bg-white p-3.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono tabular-nums">
                              <span className="text-[#64748B] line-through">
                                {formatNumber(rev.previousValue)}
                              </span>
                              <ArrowRight className="h-3 w-3 text-[#94A3B8]" />
                              <span className="font-semibold text-[#0F172A]">
                                {formatNumber(rev.newValue)}
                              </span>
                              <span
                                className={cn(
                                  'font-medium',
                                  delta >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                                )}
                              >
                                ({delta >= 0 ? `+${formatNumber(delta)}` : formatNumber(delta)})
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-[#64748B]">
                              {formatDateShort(rev.detectedAt)}
                            </span>
                          </div>
                          <p className="mt-2 leading-relaxed text-[#334155]">
                            {rev.changeReason}
                          </p>
                          <div className="mt-1.5 text-[11px] text-[#64748B]">
                            {rev.detectedBy}
                            {rev.actorEmail ? ` · ${rev.actorEmail}` : ''}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer Action */}
        {detail && (
          <div className="flex items-center justify-between border-t border-[#E2E8F0] bg-[#FAFAFA] px-6 py-3.5">
            <span className="text-xs text-[#64748B]">
              Updated {formatDateShort(detail.updatedAt)}
            </span>
            {isOwner ? (
              <button
                type="button"
                onClick={() => onRequestOverride(detail)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#172D6B] cursor-pointer"
              >
                <PenLine className="h-3.5 w-3.5" />
                Override / Correct Figure
              </button>
            ) : (
              <span className="text-xs text-[#64748B]">Read-only provenance</span>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
