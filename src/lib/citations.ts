import { formatPeriodLabel } from './utils';
import type { ReportDetailRecord } from '../types/observatory';

export type CitationFormat = 'apa' | 'chicago' | 'bibtex';

function formatMonthDayYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 4) : String(d.getFullYear());
}

function getMonthShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
}

function sanitizeBibtexKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
}

function escapeBibtexValue(input: string): string {
  return input.replace(/[{}]/g, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
}

export function formatReportCitation(
  report: ReportDetailRecord,
  format: CitationFormat
): string {
  const pubYear = getYear(report.publicationDate);
  const pubFull = formatMonthDayYear(report.publicationDate);
  const periodLabel = formatPeriodLabel(report.periodValue);
  const countFormatted = report.count.toLocaleString('en-US');
  const docRef = report.documentRef || `Record #${report.id}`;
  const todayFull = formatMonthDayYear(new Date().toISOString());
  const url = report.sourceUrl;

  if (format === 'apa') {
    return `${report.sourceName}. (${pubFull}). Gaza live birth statistics for ${periodLabel} (${countFormatted} reported births; ${report.confidenceStatus}) [${docRef}]. Archived in Gaza Births Observatory. ${url}`;
  }

  if (format === 'chicago') {
    return `${report.sourceName}. "Gaza Birth Statistics — ${periodLabel} (${countFormatted} births)." Document Ref. ${docRef}, published ${pubFull}. Archived in Gaza Births Observatory, accessed ${todayFull}. ${url}.`;
  }

  const key = `${sanitizeBibtexKey(report.sourceName)}_${report.periodValue.replace('-', '_')}_r${report.id}`;
  const snippetClean = escapeBibtexValue(report.rawTextSnippet).slice(0, 180);
  const monthToken = getMonthShort(report.publicationDate);

  return [
    `@misc{${key},`,
    `  author       = {{${escapeBibtexValue(report.sourceName)}}},`,
    `  title        = {{Gaza Birth Statistics for ${escapeBibtexValue(periodLabel)}: ${countFormatted} Reported Births}},`,
    `  year         = {${pubYear}},`,
    ...(monthToken ? [`  month        = {${monthToken}},`] : []),
    `  howpublished = {Gaza Births Observatory Archive, Ref. ${escapeBibtexValue(docRef)}},`,
    `  note         = {Status: ${escapeBibtexValue(report.confidenceStatus)}; Tier: ${escapeBibtexValue(report.sourceCredibilityTier)}; Excerpt: "${snippetClean}"},`,
    `  url          = {${url}}`,
    `}`,
  ].join('\n');
}
