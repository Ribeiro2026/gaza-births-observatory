export type SourceType =
  | 'Government'
  | 'Multilateral Agency'
  | 'News Media'
  | 'Social Media Channel';

export type CredibilityTier =
  | 'Tier 1 - Primary Registry'
  | 'Tier 2 - Multilateral'
  | 'Tier 3 - Media / Secondary';

export type PeriodType = 'Monthly' | 'Yearly';

export type ConfidenceStatus =
  | 'Pending Review'
  | 'Verified'
  | 'Disputed'
  | 'Superseded';

export interface SourceRecord {
  id: number;
  name: string;
  type: SourceType;
  urlOrHandle: string;
  credibilityTier: CredibilityTier;
  description: string;
  seriesColor: string;
  createdAt: string;
  totalReports: number;
  verifiedReports: number;
  totalRevisions: number;
}

export interface BirthReportRecord {
  id: number;
  sourceId: number;
  periodType: PeriodType;
  periodValue: string;
  count: number;
  publicationDate: string;
  sourceUrl: string;
  rawTextSnippet: string;
  documentRef: string;
  confidenceStatus: ConfidenceStatus;
  archivedAt: string;
  updatedAt: string;
  sourceName: string;
  sourceType: SourceType;
  sourceCredibilityTier: CredibilityTier;
  sourceColor: string;
  sourceHandle: string;
  revisionCount: number;
}

export interface RevisionLogRecord {
  id: number;
  birthReportId: number;
  previousValue: number;
  newValue: number;
  changeReason: string;
  detectedAt: string;
  detectedBy: 'Automated Pipeline' | 'Manual Override';
  actorEmail: string | null;
  periodType?: PeriodType;
  periodValue?: string;
  documentRef?: string;
  sourceName?: string;
  sourceColor?: string;
}

export interface ReportDetailRecord extends BirthReportRecord {
  revisions: RevisionLogRecord[];
  siblingReports: Array<{
    id: number;
    count: number;
    confidenceStatus: ConfidenceStatus;
    publicationDate: string;
    sourceName: string;
    sourceColor: string;
  }>;
}

export interface StagingRecord {
  id: number;
  sourceNameDetected: string;
  matchedSourceId: number | null;
  periodType: PeriodType;
  periodValue: string;
  extractedCount: number;
  publicationDate: string;
  sourceUrl: string;
  rawTextSnippet: string;
  documentRef: string;
  matchClassification: 'New Period' | 'Potential Revision' | 'Alternate Source';
  relatedReportId: number | null;
  reviewStatus: 'Needs Review' | 'Approved' | 'Rejected';
  rawExtractionJson: string;
  createdAt: string;
  relatedCount: number | null;
  relatedDocumentRef: string | null;
  relatedSourceId: number | null;
}

export type ContextMarkerCategory =
  | 'Disruption'
  | 'Methodology'
  | 'Reporting Shift'
  | 'Milestone';

export interface ContextMarkerRecord {
  id: string;
  dbId?: number;
  periodValue: string; // 'YYYY-MM'
  title: string;
  category: ContextMarkerCategory;
  notes: string;
  isBuiltIn: boolean;
  createdByEmail?: string | null;
  createdAt?: string;
}

