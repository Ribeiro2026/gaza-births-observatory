import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  LogIn,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  cn,
  formatDateShort,
  formatNumber,
  formatPeriodLabel,
  isSafeHttpUrl,
} from '../lib/utils';
import type {
  ConfidenceStatus,
  PeriodType,
  SourceRecord,
  StagingRecord,
} from '../types/observatory';

interface IngestionPipelineViewProps {
  sources: SourceRecord[];
  stagingItems: StagingRecord[];
  loading: boolean;
  onRefreshAll: () => void;
  onInspectReport: (reportId: number) => void;
}

const SAMPLE_DISPATCH_TEXT = `UNFPA Palestine Humanitarian Flash Update — November 24, 2026 (Ref: UNFPA-SR-2026-11-MID)
According to maternal health partners operating across Gaza governorates, approximately 4,460 births are projected for November 2026 across hospitals, NGO maternity centers, and mobile midwife teams. Meanwhile, an addendum from the Ministry of Health (MOH Gaza) revised the October 2026 facility tally upward to 4,145 births after receiving delayed paper registers from northern wards.`;

const PRESET_FEEDS = [
  {
    label: 'ReliefWeb Palestine Updates RSS',
    url: 'https://reliefweb.int/updates/rss.xml?advanced-search=(PC180)',
    sourceHint: 'UN OCHA',
  },
  {
    label: 'Al Jazeera All News RSS',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    sourceHint: 'Al Jazeera',
  },
];

export function IngestionPipelineView({
  sources,
  stagingItems,
  loading,
  onRefreshAll,
  onInspectReport,
}: IngestionPipelineViewProps) {
  const { isOwner, signIn, authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'queue' | 'extract' | 'template'>('queue');
  const [queueFilter, setQueueFilter] = useState<'Needs Review' | 'Approved' | 'Rejected' | 'All'>(
    'Needs Review'
  );

  // Live Extractor state
  const [extractMode, setExtractMode] = useState<'text' | 'url'>('text');
  const [rawText, setRawText] = useState('');
  const [pasteSourceUrl, setPasteSourceUrl] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [sourceHint, setSourceHint] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Staging item inline edits & processing
  const [editingDrafts, setEditingDrafts] = useState<
    Record<
      number,
      {
        sourceId: string;
        periodType: PeriodType;
        periodValue: string;
        count: string;
        confidenceStatus: ConfidenceStatus;
        changeReason: string;
      }
    >
  >({});
  const [expandedJsonIds, setExpandedJsonIds] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Cron Template state
  const [templateCode, setTemplateCode] = useState<string>('');
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  useEffect(() => {
    if (subTab === 'template' && !templateCode && isOwner) {
      authFetch('/api/ingest/template')
        .then(async (r) => {
          if (!r.ok) throw new Error('Unauthorized');
          return r.json();
        })
        .then((d) => setTemplateCode(d.content || ''))
        .catch(() => setTemplateCode('// Unable to load template from server.'));
    }
  }, [subTab, templateCode, isOwner, authFetch]);

  const getDraft = (item: StagingRecord) => {
    if (editingDrafts[item.id]) return editingDrafts[item.id];
    return {
      sourceId: String(item.matchedSourceId || sources[0]?.id || ''),
      periodType: item.periodType,
      periodValue: item.periodValue,
      count: String(item.extractedCount),
      confidenceStatus: 'Verified' as ConfidenceStatus,
      changeReason:
        item.matchClassification === 'Potential Revision'
          ? `Approved revision from ${item.documentRef}`
          : `Verified ingestion from ${item.documentRef}`,
    };
  };

  const updateDraft = (
    id: number,
    item: StagingRecord,
    patch: Partial<ReturnType<typeof getDraft>>
  ) => {
    setEditingDrafts((prev) => ({
      ...prev,
      [id]: { ...getDraft(item), ...patch },
    }));
  };

  const filteredQueue = stagingItems.filter((item) =>
    queueFilter === 'All' ? true : item.reviewStatus === queueFilter
  );

  const pendingCount = stagingItems.filter((i) => i.reviewStatus === 'Needs Review').length;

  const handleRunExtraction = async (e: React.FormEvent) => {
    e.preventDefault();
    setExtractError(null);
    setExtractResult(null);
    setExtracting(true);

    try {
      const endpoint =
        extractMode === 'text' ? '/api/ingest/extract-text' : '/api/ingest/fetch-url';
      const body =
        extractMode === 'text'
          ? {
              rawText,
              sourceUrl: pasteSourceUrl || undefined,
              sourceHint: sourceHint || undefined,
            }
          : {
              url: feedUrl,
              sourceHint: sourceHint || undefined,
            };

      const res = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Extraction request failed.');
      }

      if (data.extractedCount > 0) {
        setExtractResult(
          `Extracted and staged ${data.extractedCount} birth statistic ${
            data.extractedCount === 1 ? 'candidate' : 'candidates'
          } into the Needs Review queue.`
        );
        setRawText('');
        setFeedUrl('');
        onRefreshAll();
        setSubTab('queue');
        setQueueFilter('Needs Review');
      } else {
        setExtractResult(
          data.message || 'Completed scan — no explicit Gaza birth counts were found.'
        );
      }
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleApprove = async (
    item: StagingRecord,
    overrideStatus?: ConfidenceStatus
  ) => {
    setQueueError(null);
    setQueueFeedback(null);
    setBusyId(item.id);

    try {
      const draft = getDraft(item);
      const res = await authFetch(`/api/staging/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: Number(draft.sourceId),
          periodType: draft.periodType,
          periodValue: draft.periodValue.trim(),
          count: Number(draft.count),
          confidenceStatus: overrideStatus || draft.confidenceStatus,
          changeReason: draft.changeReason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Approval failed.');
      }
      setQueueFeedback(
        data.action === 'revised'
          ? `Approved revision for ${draft.periodValue} and appended a new audit log entry.`
          : `Published new birth report for ${draft.periodValue} to the live dashboard.`
      );
      onRefreshAll();
    } catch (err: unknown) {
      setQueueError(err instanceof Error ? err.message : 'Could not approve staging item.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (item: StagingRecord) => {
    setQueueError(null);
    setQueueFeedback(null);
    setBusyId(item.id);
    try {
      const res = await authFetch(`/api/staging/${item.id}/reject`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Rejection failed.');
      }
      setQueueFeedback(`Rejected staged entry (${item.documentRef}).`);
      onRefreshAll();
    } catch (err: unknown) {
      setQueueError(err instanceof Error ? err.message : 'Could not reject item.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyTemplate = async () => {
    if (!templateCode) return;
    await navigator.clipboard.writeText(templateCode);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleDownloadTemplate = () => {
    if (!templateCode) return;
    const blob = new Blob([templateCode], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gaza-births-worker.ts';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Automated Ingestion & Review Pipeline
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            Parse RSS feeds, public bulletins, and Telegram statements with Gemini structured
            extraction, deduplicate against existing periods, and approve verified figures.
          </p>
        </div>

        {/* Sub-view switcher */}
        <div
          className="inline-flex items-center rounded-md bg-[#F1F5F9] p-0.5 shrink-0"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'queue'}
            onClick={() => setSubTab('queue')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
              subTab === 'queue'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            )}
          >
            Review Queue ({pendingCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'extract'}
            onClick={() => setSubTab('extract')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
              subTab === 'extract'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            )}
          >
            Live Extractor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'template'}
            onClick={() => setSubTab('template')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
              subTab === 'template'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#475569] hover:text-[#0F172A]'
            )}
          >
            Cron Worker Template
          </button>
        </div>
      </div>

      {/* TAB 1: Needs Review Staging Queue */}
      {subTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3">
            <div className="flex items-center gap-1 rounded-md bg-[#F1F5F9] p-0.5">
              {(['Needs Review', 'Approved', 'Rejected', 'All'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setQueueFilter(st)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    queueFilter === st
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  )}
                >
                  {st}
                </button>
              ))}
            </div>

            {!isOwner && (
              <button
                type="button"
                onClick={() => signIn()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5" />
                Owner sign-in required to approve or reject items
              </button>
            )}
          </div>

          {queueFeedback && (
            <div className="rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#166534]">
              {queueFeedback}
            </div>
          )}

          {queueError && (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#991B1B]">
              {queueError}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              <div className="h-36 animate-pulse rounded-lg bg-white border border-[#E2E8F0]" />
              <div className="h-36 animate-pulse rounded-lg bg-white border border-[#E2E8F0]" />
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-10 text-center">
              <p className="text-sm font-medium text-[#0F172A]">
                No staging items in “{queueFilter}”.
              </p>
              <p className="mt-1 text-xs text-[#64748B]">
                Run the Live Extractor on an RSS feed or pasted press release to queue new
                candidates.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('extract')}
                className="mt-4 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
              >
                Open Live Extractor
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredQueue.map((item) => {
                const draft = getDraft(item);
                const isPending = item.reviewStatus === 'Needs Review';
                const isJsonOpen = expandedJsonIds.includes(item.id);
                const diffDelta =
                  item.matchClassification === 'Potential Revision' &&
                  item.relatedCount !== null
                    ? Number(draft.count || item.extractedCount) - item.relatedCount
                    : null;

                return (
                  <article
                    key={item.id}
                    className="rounded-lg border border-[#E2E8F0] bg-white"
                  >
                    {/* Top Metadata Line (Zero-Pill Editorial Format) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#FAFAFA] px-5 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'font-semibold',
                            item.matchClassification === 'Potential Revision'
                              ? 'text-[#B45309]'
                              : item.matchClassification === 'Alternate Source'
                                ? 'text-[#1E3A8A]'
                                : 'text-[#0F766E]'
                          )}
                        >
                          {item.matchClassification}
                        </span>
                        <span className="text-[#CBD5E1]">·</span>
                        <span className="font-medium text-[#0F172A]">
                          {item.sourceNameDetected}
                        </span>
                        <span className="text-[#CBD5E1]">·</span>
                        <span className="font-mono text-[#334155]">
                          {formatPeriodLabel(item.periodValue)} ({item.periodType})
                        </span>
                        <span className="text-[#CBD5E1]">·</span>
                        <span className="font-mono text-[#64748B]">{item.documentRef}</span>
                      </div>

                      <div className="flex items-center gap-3 font-mono text-[11px] text-[#64748B]">
                        <span>Pub {formatDateShort(item.publicationDate)}</span>
                        <span>·</span>
                        <span
                          className={cn(
                            'font-sans font-semibold',
                            item.reviewStatus === 'Approved'
                              ? 'text-[#15803D]'
                              : item.reviewStatus === 'Rejected'
                                ? 'text-[#64748B]'
                                : 'text-[#B45309]'
                          )}
                        >
                          {item.reviewStatus}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      {/* Revision / Existing Record Comparison Banner */}
                      {item.relatedReportId && item.relatedCount !== null && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#334155]">
                              {item.matchClassification === 'Potential Revision'
                                ? 'Revises existing record:'
                                : 'Existing period benchmark:'}
                            </span>
                            <span className="font-mono tabular-nums text-[#64748B]">
                              {formatNumber(item.relatedCount)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-[#94A3B8]" />
                            <span className="font-mono font-semibold tabular-nums text-[#0F172A]">
                              {formatNumber(Number(draft.count || item.extractedCount))}
                            </span>
                            {diffDelta !== null && (
                              <span
                                className={cn(
                                  'font-mono font-medium tabular-nums',
                                  diffDelta >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                                )}
                              >
                                ({diffDelta >= 0 ? `+${formatNumber(diffDelta)}` : formatNumber(diffDelta)})
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onInspectReport(item.relatedReportId!)}
                            className="text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                          >
                            Inspect existing ({item.relatedDocumentRef})
                          </button>
                        </div>
                      )}

                      {/* Verbatim Extracted Quote */}
                      <blockquote className="rounded-md border border-[#E2E8F0] bg-[#FAFAFA] px-4 py-3 font-serif text-sm italic leading-relaxed text-[#1E293B]">
                        “{item.rawTextSnippet}”
                      </blockquote>

                      {/* Inline Reviewer Controls */}
                      {isPending && (
                        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-5">
                          <div>
                            <label className="block text-[11px] font-medium text-[#64748B]">
                              Assign Source
                            </label>
                            <select
                              value={draft.sourceId}
                              onChange={(e) =>
                                updateDraft(item.id, item, { sourceId: e.target.value })
                              }
                              className="mt-1 w-full rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A]"
                            >
                              {sources.map((s) => (
                                <option key={s.id} value={String(s.id)}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-[#64748B]">
                              Period
                            </label>
                            <input
                              type="text"
                              value={draft.periodValue}
                              onChange={(e) =>
                                updateDraft(item.id, item, { periodValue: e.target.value })
                              }
                              className="mt-1 w-full rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0F172A]"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-[#64748B]">
                              Extracted Count
                            </label>
                            <input
                              type="number"
                              value={draft.count}
                              onChange={(e) =>
                                updateDraft(item.id, item, { count: e.target.value })
                              }
                              className="mt-1 w-full rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-[#0F172A]"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-medium text-[#64748B]">
                              Audit Note (for Revision Log)
                            </label>
                            <input
                              type="text"
                              value={draft.changeReason}
                              onChange={(e) =>
                                updateDraft(item.id, item, { changeReason: e.target.value })
                              }
                              className="mt-1 w-full rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A]"
                            />
                          </div>
                        </div>
                      )}

                      {/* Action Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F1F5F9] pt-3">
                        <div className="flex items-center gap-4 text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedJsonIds((prev) =>
                                prev.includes(item.id)
                                  ? prev.filter((id) => id !== item.id)
                                  : [...prev, item.id]
                              )
                            }
                            className="inline-flex items-center gap-1 text-[#475569] hover:text-[#0F172A] cursor-pointer"
                          >
                            <Code2 className="h-3.5 w-3.5" />
                            {isJsonOpen ? 'Hide Parsed JSON' : 'Inspect Parsed JSON'}
                          </button>

                          {isSafeHttpUrl(item.sourceUrl) && (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#1E3A8A] hover:underline"
                            >
                              Source URL
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>

                        {isPending && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={busyId === item.id || !isOwner}
                              onClick={() => handleReject(item)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={busyId === item.id || !isOwner}
                              onClick={() => handleApprove(item, 'Disputed')}
                              className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#B45309] hover:bg-[#FFFBEB] disabled:opacity-50 cursor-pointer"
                            >
                              Publish as Disputed
                            </button>
                            <button
                              type="button"
                              disabled={busyId === item.id || !isOwner}
                              onClick={() => handleApprove(item, 'Verified')}
                              className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-50 cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {item.matchClassification === 'Potential Revision'
                                ? 'Approve Revision'
                                : 'Approve & Publish'}
                            </button>
                          </div>
                        )}
                      </div>

                      {isJsonOpen && (
                        <pre className="overflow-x-auto rounded-md border border-[#E2E8F0] bg-[#0F172A] p-4 font-mono text-[11px] leading-relaxed text-[#E2E8F0]">
                          {item.rawExtractionJson}
                        </pre>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Live RSS / URL Fetcher + Paste-Text Gemini Extractor */}
      {subTab === 'extract' && (
        <section className="rounded-lg border border-[#E2E8F0] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-6 py-4">
            <div className="flex items-center gap-1 rounded-md bg-[#F1F5F9] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setExtractMode('text');
                  setExtractError(null);
                  setExtractResult(null);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  extractMode === 'text'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                Paste Bulletin / Telegram Post
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtractMode('url');
                  setExtractError(null);
                  setExtractResult(null);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  extractMode === 'url'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                )}
              >
                <Globe className="h-3.5 w-3.5" />
                Fetch Live RSS / Public URL
              </button>
            </div>

            <span className="font-mono text-[11px] text-[#64748B]">
              Parser: Gemini Structured JSON Schema → Staging Queue
            </span>
          </div>

          {!isOwner ? (
            <div className="p-10 text-center">
              <p className="font-serif text-base font-semibold text-[#0F172A]">
                Owner sign-in required to run live ingestion jobs
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#475569]">
                Live RSS fetching and Gemini extraction are restricted to the app owner.
              </p>
              <button
                type="button"
                onClick={() => signIn()}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5" />
                Owner Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleRunExtraction} className="p-6 space-y-5">
              {extractError && (
                <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]">
                  {extractError}
                </div>
              )}

              {extractResult && (
                <div className="rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#166534]">
                  {extractResult}
                </div>
              )}

              {extractMode === 'text' ? (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#334155]">
                        Press Release, Situation Report, or Telegram Message (English or Arabic)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setRawText(SAMPLE_DISPATCH_TEXT);
                          setPasteSourceUrl('https://palestine.unfpa.org/en/sitrep/feb-2025');
                          setSourceHint('UNFPA Palestine');
                        }}
                        className="text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                      >
                        Load sample dispatch
                      </button>
                    </div>
                    <textarea
                      required
                      rows={7}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder="Paste unstructured text from a humanitarian SitRep, ministry press release, or official Telegram channel post..."
                      className="mt-1.5 w-full rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-xs leading-relaxed text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-[#334155]">
                        Archive / Source URL (Optional)
                      </label>
                      <input
                        type="url"
                        value={pasteSourceUrl}
                        onChange={(e) => setPasteSourceUrl(e.target.value)}
                        placeholder="https://t.me/MOHMediaGaza/..."
                        className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#334155]">
                        Publisher Hint (Optional)
                      </label>
                      <input
                        type="text"
                        value={sourceHint}
                        onChange={(e) => setSourceHint(e.target.value)}
                        placeholder="e.g., MOH Gaza, UNFPA Palestine, Al Jazeera"
                        className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Public RSS Feed, Article, or Telegram Web Preview URL
                    </label>
                    <input
                      type="url"
                      required
                      value={feedUrl}
                      onChange={(e) => setFeedUrl(e.target.value)}
                      placeholder="https://reliefweb.int/updates/rss.xml or https://t.me/s/..."
                      className="mt-1.5 w-full rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2.5 font-mono text-xs text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#64748B]">
                      <span>Quick test feeds:</span>
                      {PRESET_FEEDS.map((preset) => (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() => {
                            setFeedUrl(preset.url);
                            setSourceHint(preset.sourceHint);
                          }}
                          className="font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Publisher Hint (Optional)
                    </label>
                    <input
                      type="text"
                      value={sourceHint}
                      onChange={(e) => setSourceHint(e.target.value)}
                      placeholder="e.g., UN OCHA, Al Jazeera, MOH Official Telegram"
                      className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-4">
                <p className="text-xs text-[#64748B]">
                  Extracted figures are checked against existing records and queued under Needs
                  Review before modifying public charts.
                </p>
                <button
                  type="submit"
                  disabled={extracting}
                  className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', extracting && 'animate-spin')} />
                  {extracting ? 'Extracting with Gemini...' : 'Run Extraction & Dedupe'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* TAB 3: Downloadable Standalone Cron Worker Template */}
      {subTab === 'template' && (
        <section className="rounded-lg border border-[#E2E8F0] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-3.5">
            <div>
              <h2 className="font-serif text-base font-semibold text-[#0F172A]">
                Automated RSS & Telegram Cron Worker (`gaza-births-worker.ts`)
              </h2>
              <p className="text-xs text-[#64748B]">
                Deploy via cron or GitHub Actions to poll RSS feeds and public Telegram web
                channels on a schedule and push extracted JSON into your staging queue.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyTemplate}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedTemplate ? 'Copied' : 'Copy Script'}
              </button>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Download .ts
              </button>
            </div>
          </div>
          <div className="p-5">
            <pre className="max-h-[540px] overflow-auto rounded-md border border-[#E2E8F0] bg-[#0F172A] p-5 font-mono text-xs leading-relaxed text-[#E2E8F0]">
              {templateCode || 'Loading worker script template...'}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
