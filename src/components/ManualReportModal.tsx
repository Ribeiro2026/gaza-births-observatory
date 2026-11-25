import React, { useEffect, useState } from 'react';
import { LogIn, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  BirthReportRecord,
  ConfidenceStatus,
  PeriodType,
  SourceRecord,
} from '../types/observatory';

interface ManualReportModalProps {
  isOpen: boolean;
  sources: SourceRecord[];
  editingReport: BirthReportRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ManualReportModal({
  isOpen,
  sources,
  editingReport,
  onClose,
  onSaved,
}: ManualReportModalProps) {
  const { user, signIn, authFetch } = useAuth();
  const [sourceId, setSourceId] = useState<string>('');
  const [periodType, setPeriodType] = useState<PeriodType>('Monthly');
  const [periodValue, setPeriodValue] = useState('2026-11');
  const [count, setCount] = useState('');
  const [publicationDate, setPublicationDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [sourceUrl, setSourceUrl] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [rawTextSnippet, setRawTextSnippet] = useState('');
  const [confidenceStatus, setConfidenceStatus] =
    useState<ConfidenceStatus>('Verified');
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingReport) {
      setSourceId(String(editingReport.sourceId));
      setPeriodType(editingReport.periodType);
      setPeriodValue(editingReport.periodValue);
      setCount(String(editingReport.count));
      setPublicationDate(editingReport.publicationDate.slice(0, 10));
      setSourceUrl(editingReport.sourceUrl);
      setDocumentRef(editingReport.documentRef);
      setRawTextSnippet(editingReport.rawTextSnippet);
      setConfidenceStatus(editingReport.confidenceStatus);
      setChangeReason('');
    } else {
      setSourceId(sources[0] ? String(sources[0].id) : '');
      setPeriodType('Monthly');
      setPeriodValue('2026-11');
      setCount('');
      setPublicationDate(new Date().toISOString().slice(0, 10));
      setSourceUrl('');
      setDocumentRef('');
      setRawTextSnippet('');
      setConfidenceStatus('Verified');
      setChangeReason('');
    }
  }, [isOpen, editingReport, sources]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const endpoint = editingReport
        ? `/api/reports/${editingReport.id}`
        : '/api/reports';
      const method = editingReport ? 'PATCH' : 'POST';

      const payload = editingReport
        ? {
            count: Number(count),
            confidenceStatus,
            sourceUrl,
            documentRef,
            rawTextSnippet,
            publicationDate,
            changeReason,
          }
        : {
            sourceId: Number(sourceId),
            periodType,
            periodValue: periodValue.trim(),
            count: Number(count),
            publicationDate,
            sourceUrl: sourceUrl.trim(),
            documentRef: documentRef.trim(),
            rawTextSnippet: rawTextSnippet.trim(),
            confidenceStatus,
            changeReason: changeReason.trim() || undefined,
          };

      const res = await authFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not save report.');
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingReport ? 'Override Birth Report' : 'Log New Birth Report'}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-[#CBD5E1] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#0F172A]">
              {editingReport
                ? `Override Report · ${editingReport.sourceName} (${editingReport.periodValue})`
                : 'Log Manual Birth Report'}
            </h2>
            <p className="mt-0.5 text-xs text-[#64748B]">
              {editingReport
                ? 'Modifying a published figure automatically appends an entry to the revision audit trail.'
                : 'If this source already has a record for the chosen period, the change will be logged as a revision.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-[#475569] hover:bg-[#F1F5F9] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!user ? (
          <div className="p-8 text-center">
            <p className="font-serif text-base font-semibold text-[#0F172A]">
              Reviewer Sign-In Required
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[#475569]">
              To preserve audit attribution on every manual submission and override, please sign in
              with your Google account.
            </p>
            <button
              type="button"
              onClick={() => signIn()}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in with Google
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-h-[78vh] overflow-y-auto px-6 py-5 space-y-4">
            {error && (
              <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#991B1B]">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Publishing Source
                </label>
                <select
                  required
                  disabled={Boolean(editingReport)}
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] disabled:bg-[#F8FAFC] disabled:text-[#64748B]"
                >
                  {sources.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Confidence Status
                </label>
                <select
                  required
                  value={confidenceStatus}
                  onChange={(e) => setConfidenceStatus(e.target.value as ConfidenceStatus)}
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                >
                  <option value="Verified">Verified</option>
                  <option value="Pending Review">Pending Review</option>
                  <option value="Disputed">Disputed</option>
                  <option value="Superseded">Superseded</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Period Type
                </label>
                <select
                  disabled={Boolean(editingReport)}
                  value={periodType}
                  onChange={(e) => {
                    const next = e.target.value as PeriodType;
                    setPeriodType(next);
                    if (next === 'Yearly' && periodValue.length > 4) {
                      setPeriodValue(periodValue.slice(0, 4));
                    } else if (next === 'Monthly' && periodValue.length === 4) {
                      setPeriodValue(`${periodValue}-01`);
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] disabled:bg-[#F8FAFC]"
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Yearly">Yearly</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Period ({periodType === 'Monthly' ? 'YYYY-MM' : 'YYYY'})
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingReport)}
                  value={periodValue}
                  onChange={(e) => setPeriodValue(e.target.value)}
                  placeholder={periodType === 'Monthly' ? '2026-11' : '2026'}
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A] disabled:bg-[#F8FAFC]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Reported Births
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={500000}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="4150"
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs tabular-nums text-[#0F172A]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Publication Date
                </label>
                <input
                  type="date"
                  required
                  value={publicationDate}
                  onChange={(e) => setPublicationDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#334155]">
                  Document Reference ID
                </label>
                <input
                  type="text"
                  required
                  value={documentRef}
                  onChange={(e) => setDocumentRef(e.target.value)}
                  placeholder="MOH-MTH-2026-11"
                  className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#334155]">
                Source URL (https://)
              </label>
              <input
                type="url"
                required
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://www.ochaopt.org/content/..."
                className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#334155]">
                Verbatim Quote / Excerpt
              </label>
              <textarea
                required
                rows={3}
                value={rawTextSnippet}
                onChange={(e) => setRawTextSnippet(e.target.value)}
                placeholder="Paste the exact sentence from the official bulletin or article supporting this count..."
                className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs leading-relaxed text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#334155]">
                Audit Justification Note {editingReport ? '(Required)' : '(Optional if new)'}
              </label>
              <input
                type="text"
                required={Boolean(editingReport)}
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="e.g., Updated monthly total published in official MOH bulletin addendum"
                className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#E2E8F0] pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? 'Saving...'
                  : editingReport
                    ? 'Save Override & Log Diff'
                    : 'Save Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
