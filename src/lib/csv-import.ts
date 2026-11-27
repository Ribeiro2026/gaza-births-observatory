import type { PeriodType } from '../types/observatory';

export interface ParsedCsvStagingRow {
  lineNumber: number;
  sourceNameDetected: string;
  periodType: PeriodType;
  periodValue: string;
  extractedCount: number;
  publicationDate: string;
  sourceUrl: string;
  documentRef: string;
  rawTextSnippet: string;
}

export interface CsvParseResult {
  rows: ParsedCsvStagingRow[];
  errors: string[];
}

export const SAMPLE_STAGING_CSV = `source_name,period_type,period_value,count,publication_date,document_ref,source_url,snippet
MOH Gaza,Monthly,2026-11,4120,2026-12-03,MOH-Gaza-2026-11,"https://www.moh.gov.ps/bulletins/2026-11","Ministry of Health maternity ward ledger reported 4,120 live births across Gaza facilities in November 2026."
UNFPA Palestine,Monthly,2026-11,4480,2026-12-05,UNFPA-SR-2026-11,"https://palestine.unfpa.org/sitreps/2026-11","UNFPA estimates approximately 4,480 live births occurred across Gaza governorates during November 2026."`;

/**
 * Lightweight RFC-4180 CSV parser supporting quoted commas, escaped double quotes,
 * and CRLF/LF newlines.
 */
function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const cleaned = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function parseStagingCsv(rawCsv: string): CsvParseResult {
  const grid = parseCsvLines(rawCsv);
  if (grid.length < 2) {
    return {
      rows: [],
      errors: ['CSV must include a header row and at least one data row.'],
    };
  }

  const headers = grid[0].map(normalizeHeader);
  const findCol = (aliases: string[]) =>
    headers.findIndex((h) => aliases.includes(h));

  const idxSource = findCol(['source_name', 'source', 'publisher']);
  const idxPeriodType = findCol(['period_type', 'granularity']);
  const idxPeriodValue = findCol(['period_value', 'period', 'month', 'year']);
  const idxCount = findCol(['count', 'birth_count', 'births', 'extracted_count']);
  const idxPubDate = findCol(['publication_date', 'published_at', 'source_date', 'date']);
  const idxDocRef = findCol(['document_ref', 'ref', 'reference', 'bulletin_ref']);
  const idxUrl = findCol(['source_url', 'url', 'link']);
  const idxSnippet = findCol(['snippet', 'raw_text_snippet', 'quote', 'notes']);

  if (idxSource === -1 || idxPeriodValue === -1 || idxCount === -1) {
    return {
      rows: [],
      errors: [
        'Missing required CSV columns. Expected at least: source_name, period_value, and count.',
      ],
    };
  }

  const rows: ParsedCsvStagingRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const lineNumber = i + 1;

    const sourceName = (cells[idxSource] || '').trim();
    const periodValue = (cells[idxPeriodValue] || '').trim();
    const rawCount = (cells[idxCount] || '').replace(/,/g, '').trim();
    const parsedCount = Number(rawCount);

    let periodType: PeriodType;
    const rawType = idxPeriodType >= 0 ? (cells[idxPeriodType] || '').trim().toLowerCase() : '';
    if (rawType === 'yearly' || rawType === 'annual') {
      periodType = 'Yearly';
    } else if (rawType === 'monthly') {
      periodType = 'Monthly';
    } else {
      periodType = /^\d{4}$/.test(periodValue) ? 'Yearly' : 'Monthly';
    }

    const validPeriod =
      periodType === 'Monthly'
        ? /^\d{4}-(0[1-9]|1[0-2])$/.test(periodValue)
        : /^\d{4}$/.test(periodValue);

    if (!sourceName || sourceName.length < 2) {
      errors.push(`Row ${lineNumber}: Missing or invalid source_name.`);
      continue;
    }
    if (!validPeriod) {
      errors.push(
        `Row ${lineNumber}: Invalid period_value "${periodValue}" for ${periodType} (use YYYY-MM or YYYY).`
      );
      continue;
    }
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 500000) {
      errors.push(`Row ${lineNumber}: Invalid birth count "${rawCount}".`);
      continue;
    }

    const publicationDate =
      (idxPubDate >= 0 ? cells[idxPubDate] : '')?.trim() ||
      new Date().toISOString().slice(0, 10);
    const documentRef =
      (idxDocRef >= 0 ? cells[idxDocRef] : '')?.trim() ||
      `CSV-${periodValue}-${lineNumber}`;
    const sourceUrl =
      (idxUrl >= 0 ? cells[idxUrl] : '')?.trim() ||
      'https://archive.observatory.local/csv-import';
    const rawTextSnippet =
      (idxSnippet >= 0 ? cells[idxSnippet] : '')?.trim() ||
      `${sourceName} reported ${parsedCount.toLocaleString('en-US')} live births for ${periodValue}.`;

    rows.push({
      lineNumber,
      sourceNameDetected: sourceName,
      periodType,
      periodValue,
      extractedCount: parsedCount,
      publicationDate,
      sourceUrl,
      documentRef,
      rawTextSnippet,
    });
  }

  if (rows.length > 200) {
    errors.push('Maximum 200 rows per bulk CSV import batch — only the first 200 valid rows are queued.');
  }

  return { rows: rows.slice(0, 200), errors };
}

export function downloadSampleStagingCsv(): void {
  const blob = new Blob([`\uFEFF${SAMPLE_STAGING_CSV}\r\n`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gaza-births-bulk-staging-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
