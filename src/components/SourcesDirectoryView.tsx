import React, { useState } from 'react';
import { ArrowRight, ExternalLink, LogIn, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatNumber, isSafeHttpUrl } from '../lib/utils';
import type {
  CredibilityTier,
  SourceRecord,
  SourceType,
} from '../types/observatory';

interface SourcesDirectoryViewProps {
  sources: SourceRecord[];
  loading: boolean;
  onRefreshAll: () => void;
  onSourceDeleted: (sourceId: number) => void;
  onExploreSource: (sourceId: number) => void;
}

const COLOR_OPTIONS = [
  '#1E3A8A',
  '#0F766E',
  '#B45309',
  '#B91C1C',
  '#6D28D9',
  '#334155',
  '#0369A1',
  '#15803D',
];

export function SourcesDirectoryView({
  sources,
  loading,
  onRefreshAll,
  onSourceDeleted,
  onExploreSource,
}: SourcesDirectoryViewProps) {
  const { user, signIn, authFetch } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<SourceType>('Multilateral Agency');
  const [urlOrHandle, setUrlOrHandle] = useState('');
  const [credibilityTier, setCredibilityTier] = useState<CredibilityTier>(
    'Tier 2 - Multilateral'
  );
  const [description, setDescription] = useState('');
  const [seriesColor, setSeriesColor] = useState(COLOR_OPTIONS[6]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceToDelete, setSourceToDelete] = useState<SourceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await authFetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          urlOrHandle,
          credibilityTier,
          description,
          seriesColor,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not create source.');
      }
      setName('');
      setUrlOrHandle('');
      setDescription('');
      setModalOpen(false);
      setStatusBanner(`Registered new source "${name.trim()}".`);
      onRefreshAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register source.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!sourceToDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await authFetch(`/api/sources/${sourceToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not remove source.');
      }
      const deletedId = sourceToDelete.id;
      const deletedName = sourceToDelete.name;
      const removedReports =
        typeof data.deletedReportsCount === 'number'
          ? data.deletedReportsCount
          : sourceToDelete.totalReports;
      setSourceToDelete(null);
      setStatusBanner(
        `Removed "${deletedName}" and ${formatNumber(removedReports)} linked birth ${
          removedReports === 1 ? 'report' : 'reports'
        }.`
      );
      onSourceDeleted(deletedId);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to remove source.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
            Source Registry & Credibility Tiers
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            Canonical registry of ministries, multilateral UN agencies, news media, and social
            channels tracked across the demographic ledger.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Register Source
        </button>
      </div>

      {statusBanner && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#CBD5E1] bg-white px-4 py-2.5 text-xs text-[#334155]">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label="Dismiss notification"
            className="rounded p-1 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Sources Editorial Catalog Table / Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-lg border border-[#E2E8F0] bg-white"
              />
            ))
          : sources.map((src) => (
              <article
                key={src.id}
                className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-white p-5"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-[3px] w-4 shrink-0"
                        style={{ backgroundColor: src.seriesColor }}
                      />
                      <h2 className="font-serif text-lg font-semibold text-[#0F172A]">
                        {src.name}
                      </h2>
                    </div>
                    <span className="font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {src.credibilityTier}
                    </span>
                  </div>

                  <div className="mt-1 text-xs text-[#64748B]">
                    {src.type}
                    {src.urlOrHandle && (
                      <>
                        {' · '}
                        {isSafeHttpUrl(src.urlOrHandle) ? (
                          <a
                            href={src.urlOrHandle}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-[#1E3A8A] hover:underline"
                          >
                            {src.urlOrHandle.replace(/^https?:\/\//, '')}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11px]">{src.urlOrHandle}</span>
                        )}
                      </>
                    )}
                  </div>

                  {src.description && (
                    <p className="mt-3 text-xs leading-relaxed text-[#475569]">
                      {src.description}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[#F1F5F9] pt-3.5 text-xs">
                  <div className="flex items-center gap-4 font-mono tabular-nums text-[#334155]">
                    <span>
                      <strong className="text-[#0F172A]">{formatNumber(src.totalReports)}</strong>{' '}
                      <span className="font-sans text-[#64748B]">reports</span>
                    </span>
                    <span>
                      <strong className="text-[#15803D]">
                        {formatNumber(src.verifiedReports)}
                      </strong>{' '}
                      <span className="font-sans text-[#64748B]">verified</span>
                    </span>
                    <span>
                      <strong className="text-[#0F172A]">
                        {formatNumber(src.totalRevisions)}
                      </strong>{' '}
                      <span className="font-sans text-[#64748B]">revisions</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => onExploreSource(src.id)}
                      className="inline-flex items-center gap-1 font-medium text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
                    >
                      Filter records
                      <ArrowRight className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setSourceToDelete(src);
                      }}
                      className="inline-flex items-center gap-1 font-medium text-[#64748B] transition-colors hover:text-[#B91C1C] whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
      </div>

      {/* Register Source Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Register Publishing Source"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-[#CBD5E1] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <h2 className="font-serif text-lg font-semibold text-[#0F172A]">
                Register Publishing Source
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1.5 text-[#475569] hover:bg-[#F1F5F9] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!user ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-[#0F172A]">
                  Sign in required to register new sources
                </p>
                <button
                  type="button"
                  onClick={() => signIn()}
                  className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in with Google
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                {error && (
                  <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs text-[#991B1B]">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#334155]">
                    Publisher Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., PCBS (Palestinian Central Bureau of Statistics)"
                    className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Source Type
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as SourceType)}
                      className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                    >
                      <option value="Government">Government</option>
                      <option value="Multilateral Agency">Multilateral Agency</option>
                      <option value="News Media">News Media</option>
                      <option value="Social Media Channel">Social Media Channel</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#334155]">
                      Credibility Tier
                    </label>
                    <select
                      value={credibilityTier}
                      onChange={(e) =>
                        setCredibilityTier(e.target.value as CredibilityTier)
                      }
                      className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                    >
                      <option value="Tier 1 - Primary Registry">Tier 1 - Primary Registry</option>
                      <option value="Tier 2 - Multilateral">Tier 2 - Multilateral</option>
                      <option value="Tier 3 - Media / Secondary">Tier 3 - Media / Secondary</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#334155]">
                    Website URL or Official Handle
                  </label>
                  <input
                    type="text"
                    required
                    value={urlOrHandle}
                    onChange={(e) => setUrlOrHandle(e.target.value)}
                    placeholder="https://www.pcbs.gov.ps or @channel_handle"
                    className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#334155]">
                    Methodological Scope & Notes
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Briefly describe how this publisher compiles birth counts..."
                    className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#334155]">
                    Chart Series Color
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    {COLOR_OPTIONS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setSeriesColor(hex)}
                        aria-label={`Select color ${hex}`}
                        className="h-6 w-6 rounded border transition-transform cursor-pointer"
                        style={{
                          backgroundColor: hex,
                          borderColor: seriesColor === hex ? '#0F172A' : 'transparent',
                          transform: seriesColor === hex ? 'scale(1.12)' : 'scale(1)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? 'Registering...' : 'Register Source'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* Remove Source Confirmation Modal */}
      {sourceToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Remove Publishing Source"
          onClick={() => !deleting && setSourceToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[#CBD5E1] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
              <h2 className="font-serif text-lg font-semibold text-[#0F172A]">
                Remove Publishing Source
              </h2>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setSourceToDelete(null)}
                aria-label="Close confirmation dialog"
                className="rounded p-1.5 text-[#475569] hover:bg-[#F1F5F9] disabled:opacity-50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!user ? (
              <div className="p-8 text-center">
                <p className="font-serif text-base font-semibold text-[#0F172A]">
                  Reviewer Sign-In Required
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">
                  Sign in with Google before permanently removing “{sourceToDelete.name}” from the
                  registry.
                </p>
                <button
                  type="button"
                  onClick={() => signIn()}
                  className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in with Google
                </button>
              </div>
            ) : (
              <div className="space-y-4 px-6 py-5">
                {deleteError && (
                  <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#991B1B]">
                    {deleteError}
                  </div>
                )}

                <p className="text-xs leading-relaxed text-[#334155]">
                  Are you sure you want to permanently remove{' '}
                  <strong className="font-semibold text-[#0F172A]">{sourceToDelete.name}</strong>{' '}
                  from the observatory registry? This action cannot be undone.
                </p>

                <dl className="divide-y divide-[#F1F5F9] rounded-md border border-[#E2E8F0] bg-[#FAFAFA] px-4 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-[#475569]">Linked birth reports to delete</dt>
                    <dd className="font-mono font-semibold tabular-nums text-[#B91C1C]">
                      {formatNumber(sourceToDelete.totalReports)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-[#475569]">Linked revision audit logs to delete</dt>
                    <dd className="font-mono font-semibold tabular-nums text-[#B91C1C]">
                      {formatNumber(sourceToDelete.totalRevisions)}
                    </dd>
                  </div>
                </dl>

                <p className="text-[11px] leading-relaxed text-[#64748B]">
                  Any pending items in the Ingestion Queue referencing this publisher will remain
                  queued as unassigned so reviewers can reassign or reject them.
                </p>

                <div className="flex items-center justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setSourceToDelete(null)}
                    className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleConfirmDelete}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#B91C1C] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#991B1B] disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? 'Removing...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
