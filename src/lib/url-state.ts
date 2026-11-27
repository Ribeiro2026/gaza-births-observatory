import type { ConfidenceStatus, PeriodType, SourceType } from '../types/observatory';
import type { ConfidenceScope } from '../components/TierChartPanel';

export type ObservatoryTab =
  | 'analytics'
  | 'heatmaps'
  | 'discrepancies'
  | 'explorer'
  | 'ingestion'
  | 'sources';

export interface AnalyticsUrlState {
  periodType: PeriodType;
  chartMode: 'line' | 'bar';
  yearFilter: string;
  confidenceScope: ConfidenceScope;
  showTier2Chart: boolean;
  showTier3Chart: boolean;
  lockYAxis: boolean;
  showContextMarkers: boolean;
  showProjection: boolean;
  monthlyHorizon: 3 | 6 | 12;
  yearlyHorizon: 1 | 2 | 3;
}

export interface ExplorerUrlState {
  search: string;
  periodType: 'All' | PeriodType;
  year: string;
  month: string;
  sourceType: 'All' | SourceType;
  sourceId: string;
  status: 'All' | ConfidenceStatus;
}

export interface ObservatoryUrlState {
  tab: ObservatoryTab;
  analytics: AnalyticsUrlState;
  explorer: ExplorerUrlState;
}

const VALID_TABS = new Set<ObservatoryTab>([
  'analytics',
  'heatmaps',
  'discrepancies',
  'explorer',
  'ingestion',
  'sources',
]);

const VALID_SCOPES = new Set<ConfidenceScope>(['verified', 'active', 'all']);
const VALID_SOURCE_TYPES = new Set<SourceType>([
  'Government',
  'Multilateral Agency',
  'News Media',
  'Social Media Channel',
]);
const VALID_STATUSES = new Set<ConfidenceStatus>([
  'Pending Review',
  'Verified',
  'Disputed',
  'Superseded',
]);

export const DEFAULT_ANALYTICS_URL_STATE: AnalyticsUrlState = {
  periodType: 'Monthly',
  chartMode: 'line',
  yearFilter: 'All',
  confidenceScope: 'active',
  showTier2Chart: false,
  showTier3Chart: false,
  lockYAxis: false,
  showContextMarkers: false,
  showProjection: false,
  monthlyHorizon: 6,
  yearlyHorizon: 2,
};

export const DEFAULT_EXPLORER_URL_STATE: ExplorerUrlState = {
  search: '',
  periodType: 'All',
  year: 'All',
  month: 'All',
  sourceType: 'All',
  sourceId: 'All',
  status: 'All',
};

export function readObservatoryUrlState(): ObservatoryUrlState {
  if (typeof window === 'undefined') {
    return {
      tab: 'analytics',
      analytics: { ...DEFAULT_ANALYTICS_URL_STATE },
      explorer: { ...DEFAULT_EXPLORER_URL_STATE },
    };
  }

  const p = new URLSearchParams(window.location.search);

  const rawTab = p.get('tab') as ObservatoryTab | null;
  const tab: ObservatoryTab = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'analytics';

  const rawPeriod = p.get('period');
  const periodType: PeriodType = rawPeriod === 'Yearly' ? 'Yearly' : 'Monthly';

  const rawMode = p.get('mode');
  const chartMode: 'line' | 'bar' = rawMode === 'bar' ? 'bar' : 'line';

  const rawYear = p.get('year');
  const yearFilter = rawYear && /^\d{4}$/.test(rawYear) ? rawYear : 'All';

  const rawScope = p.get('scope') as ConfidenceScope | null;
  const confidenceScope: ConfidenceScope =
    rawScope && VALID_SCOPES.has(rawScope) ? rawScope : 'active';

  const rawMh = Number(p.get('mh'));
  const monthlyHorizon: 3 | 6 | 12 =
    rawMh === 3 || rawMh === 6 || rawMh === 12 ? rawMh : 6;

  const rawYh = Number(p.get('yh'));
  const yearlyHorizon: 1 | 2 | 3 =
    rawYh === 1 || rawYh === 2 || rawYh === 3 ? rawYh : 2;

  const expPeriodRaw = p.get('ep');
  const expPeriod: 'All' | PeriodType =
    expPeriodRaw === 'Monthly' || expPeriodRaw === 'Yearly' ? expPeriodRaw : 'All';

  const expYearRaw = p.get('ey');
  const expYear = expYearRaw && /^\d{4}$/.test(expYearRaw) ? expYearRaw : 'All';

  const expMonthRaw = p.get('em');
  const expMonth =
    expMonthRaw && /^(0[1-9]|1[0-2])$/.test(expMonthRaw) ? expMonthRaw : 'All';

  const expSrcTypeRaw = p.get('est') as SourceType | null;
  const expSourceType: 'All' | SourceType =
    expSrcTypeRaw && VALID_SOURCE_TYPES.has(expSrcTypeRaw) ? expSrcTypeRaw : 'All';

  const expSrcIdRaw = p.get('esrc');
  const expSourceId =
    expSrcIdRaw && /^\d+$/.test(expSrcIdRaw) ? expSrcIdRaw : 'All';

  const expStatusRaw = p.get('estat') as ConfidenceStatus | null;
  const expStatus: 'All' | ConfidenceStatus =
    expStatusRaw && VALID_STATUSES.has(expStatusRaw) ? expStatusRaw : 'All';

  const expSearch = (p.get('q') || '').slice(0, 120);

  return {
    tab,
    analytics: {
      periodType,
      chartMode,
      yearFilter,
      confidenceScope,
      showTier2Chart: p.get('t2') === '1',
      showTier3Chart: p.get('t3') === '1',
      lockYAxis: p.get('lockY') === '1',
      showContextMarkers: p.get('markers') === '1',
      showProjection: p.get('proj') === '1',
      monthlyHorizon,
      yearlyHorizon,
    },
    explorer: {
      search: expSearch,
      periodType: expPeriod,
      year: expYear,
      month: expMonth,
      sourceType: expSourceType,
      sourceId: expSourceId,
      status: expStatus,
    },
  };
}

export function buildObservatorySearchParams(state: ObservatoryUrlState): URLSearchParams {
  const p = new URLSearchParams();

  if (state.tab !== 'analytics') {
    p.set('tab', state.tab);
  }

  const a = state.analytics;
  if (a.periodType !== 'Monthly') p.set('period', a.periodType);
  if (a.chartMode !== 'line') p.set('mode', a.chartMode);
  if (a.yearFilter !== 'All') p.set('year', a.yearFilter);
  if (a.confidenceScope !== 'active') p.set('scope', a.confidenceScope);
  if (a.showTier2Chart) p.set('t2', '1');
  if (a.showTier3Chart) p.set('t3', '1');
  if (a.lockYAxis) p.set('lockY', '1');
  if (a.showContextMarkers) p.set('markers', '1');
  if (a.showProjection) {
    p.set('proj', '1');
    if (a.monthlyHorizon !== 6) p.set('mh', String(a.monthlyHorizon));
    if (a.yearlyHorizon !== 2) p.set('yh', String(a.yearlyHorizon));
  }

  const e = state.explorer;
  if (e.search.trim()) p.set('q', e.search.trim());
  if (e.periodType !== 'All') p.set('ep', e.periodType);
  if (e.year !== 'All') p.set('ey', e.year);
  if (e.month !== 'All') p.set('em', e.month);
  if (e.sourceType !== 'All') p.set('est', e.sourceType);
  if (e.sourceId !== 'All') p.set('esrc', e.sourceId);
  if (e.status !== 'All') p.set('estat', e.status);

  return p;
}

export function syncObservatoryUrlState(state: ObservatoryUrlState): void {
  if (typeof window === 'undefined') return;
  const params = buildObservatorySearchParams(state);
  const query = params.toString();
  const nextUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;

  if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}

export function getShareableObservatoryUrl(state: ObservatoryUrlState): string {
  if (typeof window === 'undefined') return '';
  const params = buildObservatorySearchParams(state);
  const query = params.toString();
  return query
    ? `${window.location.origin}${window.location.pathname}?${query}`
    : `${window.location.origin}${window.location.pathname}`;
}
