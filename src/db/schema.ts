import { relations } from 'drizzle-orm';
import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default('Researcher'),
  role: text('role').notNull().default('reviewer'), // 'admin' | 'reviewer'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // 'Government' | 'Multilateral Agency' | 'News Media' | 'Social Media Channel'
  urlOrHandle: text('url_or_handle').notNull(),
  credibilityTier: text('credibility_tier').notNull(), // 'Tier 1 - Primary Registry' | 'Tier 2 - Multilateral' | 'Tier 3 - Media / Secondary'
  description: text('description').notNull().default(''),
  seriesColor: text('series_color').notNull().default('#1E3A8A'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const birthReports = pgTable('birth_reports', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id')
    .references(() => sources.id, { onDelete: 'cascade' })
    .notNull(),
  periodType: text('period_type').notNull(), // 'Monthly' | 'Yearly'
  periodValue: text('period_value').notNull(), // e.g. '2024-03' or '2023'
  count: integer('count').notNull(),
  publicationDate: timestamp('publication_date').notNull(),
  sourceUrl: text('source_url').notNull(),
  rawTextSnippet: text('raw_text_snippet').notNull(),
  documentRef: text('document_ref').notNull(),
  confidenceStatus: text('confidence_status').notNull().default('Pending Review'), // 'Pending Review' | 'Verified' | 'Disputed' | 'Superseded'
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dataRevisionLogs = pgTable('data_revision_logs', {
  id: serial('id').primaryKey(),
  birthReportId: integer('birth_report_id')
    .references(() => birthReports.id, { onDelete: 'cascade' })
    .notNull(),
  previousValue: integer('previous_value').notNull(),
  newValue: integer('new_value').notNull(),
  changeReason: text('change_reason').notNull(),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  detectedBy: text('detected_by').notNull(), // 'Automated Pipeline' | 'Manual Override'
  actorEmail: text('actor_email'),
});

export const ingestionStaging = pgTable('ingestion_staging', {
  id: serial('id').primaryKey(),
  sourceNameDetected: text('source_name_detected').notNull(),
  matchedSourceId: integer('matched_source_id').references(() => sources.id, {
    onDelete: 'set null',
  }),
  periodType: text('period_type').notNull(), // 'Monthly' | 'Yearly'
  periodValue: text('period_value').notNull(),
  extractedCount: integer('extracted_count').notNull(),
  publicationDate: timestamp('publication_date').notNull(),
  sourceUrl: text('source_url').notNull(),
  rawTextSnippet: text('raw_text_snippet').notNull(),
  documentRef: text('document_ref').notNull(),
  matchClassification: text('match_classification').notNull(), // 'New Period' | 'Potential Revision' | 'Alternate Source'
  relatedReportId: integer('related_report_id').references(() => birthReports.id, {
    onDelete: 'set null',
  }),
  reviewStatus: text('review_status').notNull().default('Needs Review'), // 'Needs Review' | 'Approved' | 'Rejected'
  rawExtractionJson: text('raw_extraction_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sourcesRelations = relations(sources, ({ many }) => ({
  reports: many(birthReports),
  stagedItems: many(ingestionStaging),
}));

export const birthReportsRelations = relations(birthReports, ({ one, many }) => ({
  source: one(sources, {
    fields: [birthReports.sourceId],
    references: [sources.id],
  }),
  revisions: many(dataRevisionLogs),
}));

export const dataRevisionLogsRelations = relations(dataRevisionLogs, ({ one }) => ({
  birthReport: one(birthReports, {
    fields: [dataRevisionLogs.birthReportId],
    references: [birthReports.id],
  }),
}));

export const ingestionStagingRelations = relations(ingestionStaging, ({ one }) => ({
  matchedSource: one(sources, {
    fields: [ingestionStaging.matchedSourceId],
    references: [sources.id],
  }),
  relatedReport: one(birthReports, {
    fields: [ingestionStaging.relatedReportId],
    references: [birthReports.id],
  }),
}));
