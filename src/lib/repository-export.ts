import { formatPeriodLabel } from './utils';
import type {
  BirthReportRecord,
  RevisionLogRecord,
  SourceRecord,
} from '../types/observatory';

/**
 * RFC-4180 CSV escaping with spreadsheet formula-injection protection for text cells.
 * Numeric cells remain unquoted raw integers for immediate statistical import.
 */
function escapeCsvText(value: string | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function escapeCsvNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(value);
}

function formatIsoDate(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return d.toISOString().slice(0, 10);
}

function formatIsoTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return d.toISOString();
}

export function exportFullRepositoryToCsv(
  reports: BirthReportRecord[],
  sources: SourceRecord[],
  revisions: RevisionLogRecord[],
  filename?: string
): void {
  const sourceById = new Map<number, SourceRecord>();
  for (const s of sources) {
    sourceById.set(s.id, s);
  }

  // Track the most recent revision per birthReportId for inline audit enrichment
  const latestRevisionByReportId = new Map<number, RevisionLogRecord>();
  for (const rev of revisions) {
    const existing = latestRevisionByReportId.get(rev.birthReportId);
    if (
      !existing ||
      new Date(rev.detectedAt).getTime() > new Date(existing.detectedAt).getTime()
    ) {
      latestRevisionByReportId.set(rev.birthReportId, rev);
    }
  }

  const ordered = [...reports].sort((a, b) => {
    const periodCmp = b.periodValue.localeCompare(a.periodValue);
    if (periodCmp !== 0) return periodCmp;
    const sourceCmp = a.sourceName.localeCompare(b.sourceName);
    if (sourceCmp !== 0) return sourceCmp;
    return (
      new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime()
    );
  });

  const headers = [
    'report_id',
    'period_type',
    'period_value',
    'period_label',
    'birth_count',
    'confidence_status',
    'source_id',
    'source_name',
    'source_type',
    'credibility_tier',
    'source_handle_or_url',
    'publication_date',
    'archived_at',
    'updated_at',
    'document_ref',
    'source_url',
    'revision_count',
    'latest_revision_summary',
    'raw_text_snippet',
  ];

  const rows = ordered.map((r) => {
    const src = sourceById.get(r.sourceId);
    const latestRev = latestRevisionByReportId.get(r.id);
    let latestRevisionSummary = '';
    if (latestRev) {
      const delta = latestRev.newValue - latestRev.previousValue;
      const deltaLabel = delta >= 0 ? `+${delta}` : String(delta);
      latestRevisionSummary = `${latestRev.previousValue} -> ${latestRev.newValue} (${deltaLabel}, ${formatIsoDate(latestRev.detectedAt)}): ${latestRev.changeReason}`;
    }

    return [
      escapeCsvNumber(r.id),
      escapeCsvText(r.periodType),
      escapeCsvText(r.periodValue),
      escapeCsvText(formatPeriodLabel(r.periodValue)),
      escapeCsvNumber(r.count),
      escapeCsvText(r.confidenceStatus),
      escapeCsvNumber(r.sourceId),
      escapeCsvText(r.sourceName),
      escapeCsvText(r.sourceType),
      escapeCsvText(r.sourceCredibilityTier),
      escapeCsvText(src?.urlOrHandle || ''),
      escapeCsvText(formatIsoDate(r.publicationDate)),
      escapeCsvText(formatIsoTimestamp(r.archivedAt)),
      escapeCsvText(formatIsoTimestamp(r.updatedAt)),
      escapeCsvText(r.documentRef),
      escapeCsvText(r.sourceUrl),
      escapeCsvNumber(r.revisionCount),
      escapeCsvText(latestRevisionSummary),
      escapeCsvText(r.rawTextSnippet),
    ].join(',');
  });

  // Prepend UTF-8 BOM for seamless Excel/Google Sheets Unicode & Arabic quote decoding
  const csvContent = `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}\r\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    filename ||
    `gaza-births-repository-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
