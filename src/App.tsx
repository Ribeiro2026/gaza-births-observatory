import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart2,
  BookOpen,
  Grid3X3,
  Inbox,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Table2,
  X,
} from 'lucide-react';
import { AnalyticsView } from './components/AnalyticsView';
import { BirthHeatmapsPanel } from './components/BirthHeatmapsPanel';
import { DataExplorerView } from './components/DataExplorerView';
import { IngestionPipelineView } from './components/IngestionPipelineView';
import { ManualReportModal } from './components/ManualReportModal';
import { SourceInspectorDrawer } from './components/SourceInspectorDrawer';
import { SourcesDirectoryView } from './components/SourcesDirectoryView';
import { useAuth } from './context/AuthContext';
import { cn } from './lib/utils';
import type {
  BirthReportRecord,
  RevisionLogRecord,
  SourceRecord,
  StagingRecord,
} from './types/observatory';

type ActiveTab = 'analytics' | 'heatmaps' | 'explorer' | 'ingestion' | 'sources';

const TAB_LABELS: Record<ActiveTab, string> = {
  analytics: 'Analytics & Discrepancies',
  heatmaps: 'Heatmaps & Matrices',
  explorer: 'Data Explorer',
  ingestion: 'Ingestion Pipeline',
  sources: 'Source Registry',
};

export default function App() {
  const { user, role, loading: authLoading, signIn, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [reports, setReports] = useState<BirthReportRecord[]>([]);
  const [revisions, setRevisions] = useState<RevisionLogRecord[]>([]);
  const [stagingItems, setStagingItems] = useState<StagingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inspectedReportId, setInspectedReportId] = useState<number | null>(null);
  const [inspectorRefreshNonce, setInspectorRefreshNonce] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<BirthReportRecord | null>(null);
  const [explorerSourceFilter, setExplorerSourceFilter] = useState<number | null>(null);

  const fetchAllData = useCallback(async () => {
    setLoadError(null);
    try {
      const [srcRes, repRes, revRes, stgRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/reports'),
        fetch('/api/revisions'),
        fetch('/api/staging'),
      ]);

      if (!srcRes.ok || !repRes.ok || !revRes.ok || !stgRes.ok) {
        throw new Error('One or more observatory endpoints returned an error.');
      }

      const [srcData, repData, revData, stgData] = await Promise.all([
        srcRes.json(),
        repRes.json(),
        revRes.json(),
        stgRes.json(),
      ]);

      setSources(srcData);
      setReports(repData);
      setRevisions(revData);
      setStagingItems(stgData);
      setInspectorRefreshNonce((n) => n + 1);
    } catch (err: unknown) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Unable to load demographic records. Please retry.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const pendingStagingCount = stagingItems.filter(
    (s) => s.reviewStatus === 'Needs Review'
  ).length;

  const openNewReportModal = () => {
    setEditingReport(null);
    setModalOpen(true);
  };

  const openOverrideModal = (report: BirthReportRecord) => {
    setEditingReport(report);
    setModalOpen(true);
  };

  const handleExploreSource = (sourceId: number) => {
    setExplorerSourceFilter(sourceId);
    setActiveTab('explorer');
  };

  const handleSourceDeleted = useCallback(
    (deletedSourceId: number) => {
      setExplorerSourceFilter((current) =>
        current === deletedSourceId ? null : current
      );
      setInspectedReportId((currentReportId) => {
        if (!currentReportId) return null;
        const currentReport = reports.find((r) => r.id === currentReportId);
        return currentReport?.sourceId === deletedSourceId ? null : currentReportId;
      });
      fetchAllData();
    },
    [reports, fetchAllData]
  );

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    meta?: string;
  }> = [
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'heatmaps', label: 'Heatmaps', icon: Grid3X3 },
    {
      id: 'explorer',
      label: 'Data Explorer',
      icon: Table2,
      meta: reports.length > 0 ? String(reports.length) : undefined,
    },
    {
      id: 'ingestion',
      label: 'Ingestion Queue',
      icon: Inbox,
      meta: pendingStagingCount > 0 ? String(pendingStagingCount) : undefined,
    },
    {
      id: 'sources',
      label: 'Sources',
      icon: BookOpen,
      meta: sources.length > 0 ? String(sources.length) : undefined,
    },
  ];

  const SidebarContent = (
    <div className="flex h-full flex-col justify-between bg-white">
      <div>
        {/* Brand Wordmark */}
        <div className="flex h-14 items-center justify-between border-b border-[#E2E8F0] px-5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('analytics');
              setMobileMenuOpen(false);
            }}
            className="font-serif text-[17px] font-semibold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Gaza Births Observatory
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="rounded p-1 text-[#475569] hover:bg-[#F1F5F9] lg:hidden cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace Navigation */}
        <nav className="space-y-1 px-3 py-4" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  active
                    ? 'bg-[#F1F5F9] text-[#0F172A]'
                    : 'text-[#475569] hover:bg-[#FAFAFA] hover:text-[#0F172A]'
                )}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      active ? 'text-[#1E3A8A]' : 'text-[#64748B]'
                    )}
                  />
                  {item.label}
                </span>
                {item.meta && (
                  <span
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      item.id === 'ingestion' && pendingStagingCount > 0
                        ? 'font-semibold text-[#1E3A8A]'
                        : 'text-[#64748B]'
                    )}
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Reviewer Account Footer */}
      <div className="border-t border-[#E2E8F0] p-4">
        {authLoading ? (
          <div className="h-9 animate-pulse rounded bg-[#F1F5F9]" />
        ) : user ? (
          <div className="space-y-2.5">
            <div className="truncate">
              <div className="truncate text-xs font-medium text-[#0F172A]">
                {user.displayName || user.email}
              </div>
              <div className="truncate text-[11px] text-[#64748B]">
                {user.email} · {role === 'admin' ? 'Admin' : 'Reviewer'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-[#64748B]">
              Sign in with Google to log reports, override counts, or approve staged extractions.
            </p>
            <button
              type="button"
              onClick={() => signIn()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium text-[#0F172A] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5 text-[#1E3A8A]" />
              Sign in with Google
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#FAFAFA] text-[#0F172A]">
      {/* Fixed Desktop Sidebar */}
      <aside className="hidden w-[252px] shrink-0 border-r border-[#E2E8F0] bg-white lg:block">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-[#0F172A]/30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="h-full w-[264px] border-r border-[#E2E8F0] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-[#E2E8F0] bg-white/95 px-5 backdrop-blur-xs lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-1.5 text-[#475569] hover:bg-[#F1F5F9] lg:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-xs text-[#64748B] truncate">
              <span className="hidden sm:inline whitespace-nowrap">Observatory</span>
              <span className="hidden sm:inline text-[#CBD5E1]">/</span>
              <span className="font-medium text-[#0F172A] truncate">
                {TAB_LABELS[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={openNewReportModal}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1E3A8A] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#172D6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Log Report
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-7 lg:px-8">
          {loadError && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => fetchAllData()}
                className="font-medium underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {activeTab === 'analytics' && (
            <AnalyticsView
              sources={sources}
              reports={reports}
              revisions={revisions}
              pendingStagingCount={pendingStagingCount}
              loading={loading}
              onInspectReport={(id) => setInspectedReportId(id)}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'heatmaps' && (
            <div className="space-y-8">
              <div className="max-w-2xl">
                <h1 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-[#0F172A]">
                  Demographic Heatmaps & Divergence Matrices
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
                  Compare monthly intensity patterns across 2023–2026 alongside publisher-by-month
                  coverage gaps and consensus deviations. Click any tile to inspect its source quote
                  and revision trail, or export any matrix as a watermarked PNG.
                </p>
              </div>

              <BirthHeatmapsPanel
                sources={sources}
                reports={reports}
                loading={loading}
                initialMode="calendar"
                onInspectReport={(id) => setInspectedReportId(id)}
              />

              <BirthHeatmapsPanel
                sources={sources}
                reports={reports}
                loading={loading}
                initialMode="matrix"
                onInspectReport={(id) => setInspectedReportId(id)}
              />
            </div>
          )}

          {activeTab === 'explorer' && (
            <DataExplorerView
              reports={reports}
              sources={sources}
              loading={loading}
              initialSourceId={explorerSourceFilter}
              onClearInitialSource={() => setExplorerSourceFilter(null)}
              onInspectReport={(id) => setInspectedReportId(id)}
              onOpenNewReport={openNewReportModal}
              onOpenOverride={openOverrideModal}
            />
          )}

          {activeTab === 'ingestion' && (
            <IngestionPipelineView
              sources={sources}
              stagingItems={stagingItems}
              loading={loading}
              onRefreshAll={fetchAllData}
              onInspectReport={(id) => setInspectedReportId(id)}
            />
          )}

          {activeTab === 'sources' && (
            <SourcesDirectoryView
              sources={sources}
              loading={loading}
              onRefreshAll={fetchAllData}
              onSourceDeleted={handleSourceDeleted}
              onExploreSource={handleExploreSource}
            />
          )}
        </main>
      </div>

      {/* Slide-Over Source & Revision Inspector Drawer */}
      <SourceInspectorDrawer
        reportId={inspectedReportId}
        refreshNonce={inspectorRefreshNonce}
        onClose={() => setInspectedReportId(null)}
        onSelectReportId={(id) => setInspectedReportId(id)}
        onRequestOverride={(report) => openOverrideModal(report)}
      />

      {/* Manual Entry & Override Modal */}
      <ManualReportModal
        isOpen={modalOpen}
        sources={sources}
        editingReport={editingReport}
        onClose={() => setModalOpen(false)}
        onSaved={() => fetchAllData()}
      />
    </div>
  );
}
