import type { ContextMarkerCategory, ContextMarkerRecord } from '../types/observatory';

export interface DbContextMarkerRow {
  id: number;
  periodValue: string;
  title: string;
  category: string;
  notes: string;
  createdByEmail: string | null;
  createdAt: string;
}

/**
 * Curated baseline milestones explaining major reporting disruptions, hospital outages,
 * and civil-registry reconciliation shifts across the monthly Gaza births series.
 */
export const CURATED_CONTEXT_MARKERS: ContextMarkerRecord[] = [
  {
    id: 'builtin-2023-10',
    periodValue: '2023-10',
    title: 'Hospital Reporting Disruption',
    category: 'Disruption',
    notes:
      'Onset of severe hospital connectivity and civil-registration disruptions across northern and central Gaza.',
    isBuiltIn: true,
  },
  {
    id: 'builtin-2024-01',
    periodValue: '2024-01',
    title: 'Registry Backlogs Peak',
    category: 'Reporting Shift',
    notes:
      'Widest divergence between civil-status registrations (MOI), facility tallies (MOH), and UN population models.',
    isBuiltIn: true,
  },
  {
    id: 'builtin-2024-05',
    periodValue: '2024-05',
    title: 'Rafah Maternity Disruptions',
    category: 'Disruption',
    notes:
      'Closure and relocation of primary southern maternity wards shifted deliveries to field clinics and NGO tents.',
    isBuiltIn: true,
  },
  {
    id: 'builtin-2025-01',
    periodValue: '2025-01',
    title: 'Delayed Ledger Reconciliation',
    category: 'Methodology',
    notes:
      'Consolidated paper registers from southern and central clinics integrated into monthly ministry bulletins.',
    isBuiltIn: true,
  },
  {
    id: 'builtin-2026-01',
    periodValue: '2026-01',
    title: 'Unified Bulletin Cadence',
    category: 'Milestone',
    notes:
      'Alignment of recurring monthly MOH registry releases alongside alternating UN OCHA and UNFPA situation updates.',
    isBuiltIn: true,
  },
];

const VALID_CATEGORIES = new Set<ContextMarkerCategory>([
  'Disruption',
  'Methodology',
  'Reporting Shift',
  'Milestone',
]);

export function mergeContextMarkers(dbRows: DbContextMarkerRow[]): ContextMarkerRecord[] {
  const customMarkers: ContextMarkerRecord[] = dbRows.map((row) => ({
    id: `custom-${row.id}`,
    dbId: row.id,
    periodValue: row.periodValue,
    title: row.title,
    category: VALID_CATEGORIES.has(row.category as ContextMarkerCategory)
      ? (row.category as ContextMarkerCategory)
      : 'Reporting Shift',
    notes: row.notes || '',
    isBuiltIn: false,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
  }));

  return [...CURATED_CONTEXT_MARKERS, ...customMarkers].sort((a, b) => {
    const cmp = a.periodValue.localeCompare(b.periodValue);
    if (cmp !== 0) return cmp;
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function getMarkerStrokeColor(category: ContextMarkerCategory): string {
  switch (category) {
    case 'Disruption':
      return '#B91C1C';
    case 'Methodology':
      return '#0F766E';
    case 'Milestone':
      return '#1E3A8A';
    case 'Reporting Shift':
    default:
      return '#B45309';
  }
}
