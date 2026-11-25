import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  History,
  PenLine,
  X,
} from 'lucide-react';
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

interface SourceInspectorDrawerProps {
  reportId: number | null;
  refreshNonce: number;
  onClose: () => void;
  onSelectReportId: (id: number) => void;
  onRequestOverride: (report: BirthReportRecord) => void;
}

export function SourceInspectorDrawer({
  reportId,
  refreshNonce,
  onClose,
  onSelectReportId,
  onRequestOverride,
}: SourceInspectorDrawerProps) {
  const [detail, setDetail] = useState<ReportDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/25 transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-label="Source and Revision Inspector"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-[540px] flex-col border-l border-[#CBD5E1] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4">
          <div>
            <div className="text-xs text-[#64748B]">
              Source Provenance & Revision Inspector
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
                    <dd className="col-span-2 truncate">
                      {isSafeHttpUrl(detail.sourceUrl) ? (
                        <a
                          href={detail.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[#1E3A8A] hover:underline"
                        >
                          <span className="truncate">{detail.sourceUrl}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="font-mono text-[11px] text-[#64748B]">
                          {detail.sourceUrl}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
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
                    Revision History & Diff Log
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
            <button
              type="button"
              onClick={() => onRequestOverride(detail)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#172D6B] cursor-pointer"
            >
              <PenLine className="h-3.5 w-3.5" />
              Override / Correct Figure
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
