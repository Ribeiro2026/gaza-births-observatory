import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  birthReports,
  contextMarkers,
  dataRevisionLogs,
  ingestionStaging,
  sources,
} from './schema.ts';
import { ensureSeeded } from './seed.ts';

export interface ReportFilters {
  periodType?: string;
  year?: string;
  month?: string;
  sourceId?: number;
  sourceType?: string;
  confidenceStatus?: string;
  publishedFrom?: string;
  publishedTo?: string;
  search?: string;
}

export async function listSources() {
  try {
    await ensureSeeded();
    const allSources = await db.select().from(sources).orderBy(sources.id);
    const reportCounts = await db
      .select({
        sourceId: birthReports.sourceId,
        totalReports: sql<number>`count(*)::int`,
        verifiedReports: sql<number>`count(*) filter (where ${birthReports.confidenceStatus} = 'Verified')::int`,
      })
      .from(birthReports)
      .groupBy(birthReports.sourceId);

    const revisionCounts = await db
      .select({
        sourceId: birthReports.sourceId,
        totalRevisions: sql<number>`count(${dataRevisionLogs.id})::int`,
      })
      .from(dataRevisionLogs)
      .innerJoin(birthReports, eq(dataRevisionLogs.birthReportId, birthReports.id))
      .groupBy(birthReports.sourceId);

    const rMap = new Map(reportCounts.map((r) => [r.sourceId, r]));
    const revMap = new Map(revisionCounts.map((r) => [r.sourceId, r.totalRevisions]));

    return allSources.map((src) => ({
      ...src,
      totalReports: rMap.get(src.id)?.totalReports ?? 0,
      verifiedReports: rMap.get(src.id)?.verifiedReports ?? 0,
      totalRevisions: revMap.get(src.id) ?? 0,
    }));
  } catch (error) {
    console.error('Database query failed (listSources):', error);
    throw new Error('Failed to load sources from the database.', { cause: error });
  }
}

export async function createSource(input: {
  name: string;
  type: string;
  urlOrHandle: string;
  credibilityTier: string;
  description?: string;
  seriesColor?: string;
}) {
  try {
    await ensureSeeded();
    const [created] = await db
      .insert(sources)
      .values({
        name: input.name.trim(),
        type: input.type,
        urlOrHandle: input.urlOrHandle.trim(),
        credibilityTier: input.credibilityTier,
        description: input.description?.trim() || '',
        seriesColor: input.seriesColor || '#0369A1',
      })
      .returning();
    return created;
  } catch (error) {
    console.error('Database insert failed (createSource):', error);
    throw new Error('Could not register source. Ensure the source name is unique.', {
      cause: error,
    });
  }
}

export async function updateSource(
  sourceId: number,
  input: {
    name: string;
    type: string;
    urlOrHandle: string;
    credibilityTier: string;
    description?: string;
    seriesColor?: string;
  }
) {
  try {
    await ensureSeeded();
    const [updated] = await db
      .update(sources)
      .set({
        name: input.name.trim(),
        type: input.type,
        urlOrHandle: input.urlOrHandle.trim(),
        credibilityTier: input.credibilityTier,
        description: input.description?.trim() ?? '',
        seriesColor: input.seriesColor || '#0369A1',
      })
      .where(eq(sources.id, sourceId))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('Database update failed (updateSource):', error);
    throw new Error('Could not update source. Ensure the source name is unique.', {
      cause: error,
    });
  }
}

export async function deleteSource(sourceId: number) {
  try {
    await ensureSeeded();
    const linkedCounts = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(birthReports)
      .where(eq(birthReports.sourceId, sourceId));

    const deletedReportsCount = linkedCounts[0]?.count ?? 0;

    const deletedRows = await db
      .delete(sources)
      .where(eq(sources.id, sourceId))
      .returning();

    if (deletedRows.length === 0) {
      return null;
    }

    return {
      deletedSource: deletedRows[0],
      deletedReportsCount,
    };
  } catch (error) {
    console.error('Database delete failed (deleteSource):', error);
    throw new Error('Failed to remove source from the database.', {
      cause: error,
    });
  }
}

export async function listReports(filters: ReportFilters = {}) {
  try {
    await ensureSeeded();
    const conditions = [];

    if (filters.periodType && filters.periodType !== 'All') {
      conditions.push(eq(birthReports.periodType, filters.periodType));
    }
    if (filters.year && filters.year !== 'All') {
      conditions.push(ilike(birthReports.periodValue, `${filters.year}%`));
    }
    if (filters.month && filters.month !== 'All') {
      const m = filters.month.padStart(2, '0');
      conditions.push(ilike(birthReports.periodValue, `%-${m}`));
    }
    if (filters.sourceId) {
      conditions.push(eq(birthReports.sourceId, filters.sourceId));
    }
    if (filters.sourceType && filters.sourceType !== 'All') {
      conditions.push(eq(sources.type, filters.sourceType));
    }
    if (filters.confidenceStatus && filters.confidenceStatus !== 'All') {
      conditions.push(eq(birthReports.confidenceStatus, filters.confidenceStatus));
    }
    if (filters.publishedFrom) {
      const d = new Date(filters.publishedFrom);
      if (!Number.isNaN(d.getTime())) {
        conditions.push(gte(birthReports.publicationDate, d));
      }
    }
    if (filters.publishedTo) {
      const d = new Date(filters.publishedTo);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        conditions.push(lte(birthReports.publicationDate, d));
      }
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(birthReports.rawTextSnippet, q),
          ilike(birthReports.documentRef, q),
          ilike(birthReports.periodValue, q),
          ilike(sources.name, q)
        )
      );
    }

    const rows = await db
      .select({
        id: birthReports.id,
        sourceId: birthReports.sourceId,
        periodType: birthReports.periodType,
        periodValue: birthReports.periodValue,
        count: birthReports.count,
        publicationDate: birthReports.publicationDate,
        sourceUrl: birthReports.sourceUrl,
        rawTextSnippet: birthReports.rawTextSnippet,
        documentRef: birthReports.documentRef,
        confidenceStatus: birthReports.confidenceStatus,
        archivedAt: birthReports.archivedAt,
        updatedAt: birthReports.updatedAt,
        sourceName: sources.name,
        sourceType: sources.type,
        sourceCredibilityTier: sources.credibilityTier,
        sourceColor: sources.seriesColor,
        sourceHandle: sources.urlOrHandle,
      })
      .from(birthReports)
      .innerJoin(sources, eq(birthReports.sourceId, sources.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(birthReports.periodValue), desc(birthReports.publicationDate));

    const revCounts = await db
      .select({
        birthReportId: dataRevisionLogs.birthReportId,
        revisionCount: sql<number>`count(*)::int`,
      })
      .from(dataRevisionLogs)
      .groupBy(dataRevisionLogs.birthReportId);

    const revMap = new Map(revCounts.map((r) => [r.birthReportId, r.revisionCount]));

    return rows.map((row) => ({
      ...row,
      revisionCount: revMap.get(row.id) ?? 0,
    }));
  } catch (error) {
    console.error('Database query failed (listReports):', error);
    throw new Error('Failed to retrieve birth statistics reports.', { cause: error });
  }
}

export async function getReportWithRevisions(reportId: number) {
  try {
    await ensureSeeded();
    const rows = await db
      .select({
        id: birthReports.id,
        sourceId: birthReports.sourceId,
        periodType: birthReports.periodType,
        periodValue: birthReports.periodValue,
        count: birthReports.count,
        publicationDate: birthReports.publicationDate,
        sourceUrl: birthReports.sourceUrl,
        rawTextSnippet: birthReports.rawTextSnippet,
        documentRef: birthReports.documentRef,
        confidenceStatus: birthReports.confidenceStatus,
        archivedAt: birthReports.archivedAt,
        updatedAt: birthReports.updatedAt,
        sourceName: sources.name,
        sourceType: sources.type,
        sourceCredibilityTier: sources.credibilityTier,
        sourceColor: sources.seriesColor,
        sourceHandle: sources.urlOrHandle,
      })
      .from(birthReports)
      .innerJoin(sources, eq(birthReports.sourceId, sources.id))
      .where(eq(birthReports.id, reportId))
      .limit(1);

    if (rows.length === 0) return null;

    const revisions = await db
      .select()
      .from(dataRevisionLogs)
      .where(eq(dataRevisionLogs.birthReportId, reportId))
      .orderBy(desc(dataRevisionLogs.detectedAt));

    const siblingReports = await db
      .select({
        id: birthReports.id,
        count: birthReports.count,
        confidenceStatus: birthReports.confidenceStatus,
        publicationDate: birthReports.publicationDate,
        sourceName: sources.name,
        sourceColor: sources.seriesColor,
      })
      .from(birthReports)
      .innerJoin(sources, eq(birthReports.sourceId, sources.id))
      .where(
        and(
          eq(birthReports.periodType, rows[0].periodType),
          eq(birthReports.periodValue, rows[0].periodValue)
        )
      )
      .orderBy(desc(birthReports.count));

    return {
      ...rows[0],
      revisions,
      siblingReports,
    };
  } catch (error) {
    console.error('Database query failed (getReportWithRevisions):', error);
    throw new Error('Failed to load report details and revision history.', {
      cause: error,
    });
  }
}

export async function createOrUpdateReport(input: {
  sourceId: number;
  periodType: string;
  periodValue: string;
  count: number;
  publicationDate: Date;
  sourceUrl: string;
  rawTextSnippet: string;
  documentRef: string;
  confidenceStatus: string;
  changeReason?: string;
  detectedBy: 'Automated Pipeline' | 'Manual Override';
  actorEmail?: string | null;
}) {
  try {
    await ensureSeeded();
    const existing = await db
      .select()
      .from(birthReports)
      .where(
        and(
          eq(birthReports.sourceId, input.sourceId),
          eq(birthReports.periodType, input.periodType),
          eq(birthReports.periodValue, input.periodValue)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const prev = existing[0];
      const [updated] = await db
        .update(birthReports)
        .set({
          count: input.count,
          publicationDate: input.publicationDate,
          sourceUrl: input.sourceUrl,
          rawTextSnippet: input.rawTextSnippet,
          documentRef: input.documentRef,
          confidenceStatus: input.confidenceStatus,
          updatedAt: new Date(),
        })
        .where(eq(birthReports.id, prev.id))
        .returning();

      if (prev.count !== input.count) {
        await db.insert(dataRevisionLogs).values({
          birthReportId: prev.id,
          previousValue: prev.count,
          newValue: input.count,
          changeReason:
            input.changeReason?.trim() ||
            `Updated figure from ${prev.count.toLocaleString()} to ${input.count.toLocaleString()} via ${input.detectedBy}.`,
          detectedBy: input.detectedBy,
          actorEmail: input.actorEmail ?? null,
        });
      }

      return { report: updated, action: 'revised' as const };
    }

    const [created] = await db
      .insert(birthReports)
      .values({
        sourceId: input.sourceId,
        periodType: input.periodType,
        periodValue: input.periodValue,
        count: input.count,
        publicationDate: input.publicationDate,
        sourceUrl: input.sourceUrl,
        rawTextSnippet: input.rawTextSnippet,
        documentRef: input.documentRef,
        confidenceStatus: input.confidenceStatus,
      })
      .returning();

    return { report: created, action: 'created' as const };
  } catch (error) {
    console.error('Database write failed (createOrUpdateReport):', error);
    throw new Error('Failed to save birth report to database.', { cause: error });
  }
}

export async function overrideReportById(
  reportId: number,
  input: {
    count: number;
    confidenceStatus: string;
    sourceUrl?: string;
    rawTextSnippet?: string;
    documentRef?: string;
    publicationDate?: Date;
    changeReason: string;
    actorEmail?: string | null;
  }
) {
  try {
    await ensureSeeded();
    const existingRows = await db
      .select()
      .from(birthReports)
      .where(eq(birthReports.id, reportId))
      .limit(1);

    if (existingRows.length === 0) {
      return null;
    }

    const prev = existingRows[0];
    const [updated] = await db
      .update(birthReports)
      .set({
        count: input.count,
        confidenceStatus: input.confidenceStatus,
        sourceUrl: input.sourceUrl?.trim() || prev.sourceUrl,
        rawTextSnippet: input.rawTextSnippet?.trim() || prev.rawTextSnippet,
        documentRef: input.documentRef?.trim() || prev.documentRef,
        publicationDate: input.publicationDate || prev.publicationDate,
        updatedAt: new Date(),
      })
      .where(eq(birthReports.id, reportId))
      .returning();

    if (prev.count !== input.count || input.changeReason.trim()) {
      await db.insert(dataRevisionLogs).values({
        birthReportId: prev.id,
        previousValue: prev.count,
        newValue: input.count,
        changeReason: input.changeReason.trim(),
        detectedBy: 'Manual Override',
        actorEmail: input.actorEmail ?? null,
      });
    }

    return updated;
  } catch (error) {
    console.error('Database update failed (overrideReportById):', error);
    throw new Error('Failed to update report and record revision log.', {
      cause: error,
    });
  }
}

export async function listRecentRevisions(periodValue?: string) {
  try {
    await ensureSeeded();
    const rows = await db
      .select({
        id: dataRevisionLogs.id,
        birthReportId: dataRevisionLogs.birthReportId,
        previousValue: dataRevisionLogs.previousValue,
        newValue: dataRevisionLogs.newValue,
        changeReason: dataRevisionLogs.changeReason,
        detectedAt: dataRevisionLogs.detectedAt,
        detectedBy: dataRevisionLogs.detectedBy,
        actorEmail: dataRevisionLogs.actorEmail,
        periodType: birthReports.periodType,
        periodValue: birthReports.periodValue,
        documentRef: birthReports.documentRef,
        sourceName: sources.name,
        sourceColor: sources.seriesColor,
      })
      .from(dataRevisionLogs)
      .innerJoin(birthReports, eq(dataRevisionLogs.birthReportId, birthReports.id))
      .innerJoin(sources, eq(birthReports.sourceId, sources.id))
      .where(periodValue ? eq(birthReports.periodValue, periodValue) : undefined)
      .orderBy(desc(dataRevisionLogs.detectedAt))
      .limit(50);

    return rows;
  } catch (error) {
    console.error('Database query failed (listRecentRevisions):', error);
    throw new Error('Failed to load revision history.', { cause: error });
  }
}

export async function listStagingQueue(statusFilter?: string) {
  try {
    await ensureSeeded();
    const rows = await db
      .select({
        id: ingestionStaging.id,
        sourceNameDetected: ingestionStaging.sourceNameDetected,
        matchedSourceId: ingestionStaging.matchedSourceId,
        periodType: ingestionStaging.periodType,
        periodValue: ingestionStaging.periodValue,
        extractedCount: ingestionStaging.extractedCount,
        publicationDate: ingestionStaging.publicationDate,
        sourceUrl: ingestionStaging.sourceUrl,
        rawTextSnippet: ingestionStaging.rawTextSnippet,
        documentRef: ingestionStaging.documentRef,
        matchClassification: ingestionStaging.matchClassification,
        relatedReportId: ingestionStaging.relatedReportId,
        reviewStatus: ingestionStaging.reviewStatus,
        rawExtractionJson: ingestionStaging.rawExtractionJson,
        createdAt: ingestionStaging.createdAt,
        relatedCount: birthReports.count,
        relatedDocumentRef: birthReports.documentRef,
        relatedSourceId: birthReports.sourceId,
      })
      .from(ingestionStaging)
      .leftJoin(birthReports, eq(ingestionStaging.relatedReportId, birthReports.id))
      .where(
        statusFilter && statusFilter !== 'All'
          ? eq(ingestionStaging.reviewStatus, statusFilter)
          : undefined
      )
      .orderBy(desc(ingestionStaging.createdAt));

    return rows;
  } catch (error) {
    console.error('Database query failed (listStagingQueue):', error);
    throw new Error('Failed to load ingestion staging queue.', { cause: error });
  }
}

export async function stageExtractedRecords(
  items: Array<{
    sourceNameDetected: string;
    periodType: 'Monthly' | 'Yearly';
    periodValue: string;
    extractedCount: number;
    publicationDate: Date;
    sourceUrl: string;
    rawTextSnippet: string;
    documentRef: string;
    rawExtractionJson: string;
  }>
) {
  try {
    await ensureSeeded();
    const allSources = await db.select().from(sources);

    const stagedResults = [];

    for (const item of items) {
      const normName = item.sourceNameDetected.toLowerCase();
      const matchedSource = allSources.find(
        (s) =>
          s.name.toLowerCase() === normName ||
          normName.includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(normName)
      );

      let matchClassification: 'New Period' | 'Potential Revision' | 'Alternate Source' =
        'New Period';
      let relatedReportId: number | null = null;

      if (matchedSource) {
        const sameSourceSamePeriod = await db
          .select()
          .from(birthReports)
          .where(
            and(
              eq(birthReports.sourceId, matchedSource.id),
              eq(birthReports.periodType, item.periodType),
              eq(birthReports.periodValue, item.periodValue)
            )
          )
          .limit(1);

        if (sameSourceSamePeriod.length > 0) {
          matchClassification = 'Potential Revision';
          relatedReportId = sameSourceSamePeriod[0].id;
        }
      }

      if (!relatedReportId) {
        const anySourceSamePeriod = await db
          .select()
          .from(birthReports)
          .where(
            and(
              eq(birthReports.periodType, item.periodType),
              eq(birthReports.periodValue, item.periodValue)
            )
          )
          .limit(1);

        if (anySourceSamePeriod.length > 0) {
          matchClassification = 'Alternate Source';
          relatedReportId = anySourceSamePeriod[0].id;
        }
      }

      const [inserted] = await db
        .insert(ingestionStaging)
        .values({
          sourceNameDetected: item.sourceNameDetected,
          matchedSourceId: matchedSource?.id ?? null,
          periodType: item.periodType,
          periodValue: item.periodValue,
          extractedCount: item.extractedCount,
          publicationDate: item.publicationDate,
          sourceUrl: item.sourceUrl,
          rawTextSnippet: item.rawTextSnippet,
          documentRef: item.documentRef,
          matchClassification,
          relatedReportId,
          reviewStatus: 'Needs Review',
          rawExtractionJson: item.rawExtractionJson,
        })
        .returning();

      stagedResults.push(inserted);
    }

    return stagedResults;
  } catch (error) {
    console.error('Database write failed (stageExtractedRecords):', error);
    throw new Error('Failed to store extracted entries into the review queue.', {
      cause: error,
    });
  }
}

export async function approveStagingItem(
  stagingId: number,
  options: {
    sourceId: number;
    periodType: 'Monthly' | 'Yearly';
    periodValue: string;
    count: number;
    confidenceStatus: 'Verified' | 'Disputed' | 'Pending Review' | 'Superseded';
    changeReason?: string;
    actorEmail?: string | null;
  }
) {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(ingestionStaging)
      .where(eq(ingestionStaging.id, stagingId))
      .limit(1);

    if (rows.length === 0) return null;
    const item = rows[0];

    const result = await createOrUpdateReport({
      sourceId: options.sourceId,
      periodType: options.periodType,
      periodValue: options.periodValue,
      count: options.count,
      publicationDate: item.publicationDate,
      sourceUrl: item.sourceUrl,
      rawTextSnippet: item.rawTextSnippet,
      documentRef: item.documentRef,
      confidenceStatus: options.confidenceStatus,
      changeReason:
        options.changeReason?.trim() ||
        `Approved from automated ingestion queue (${item.documentRef}).`,
      detectedBy: 'Automated Pipeline',
      actorEmail: options.actorEmail ?? null,
    });

    await db
      .update(ingestionStaging)
      .set({
        reviewStatus: 'Approved',
        matchedSourceId: options.sourceId,
        relatedReportId: result.report.id,
      })
      .where(eq(ingestionStaging.id, stagingId));

    return result;
  } catch (error) {
    console.error('Database transaction failed (approveStagingItem):', error);
    throw new Error('Failed to approve staging item.', { cause: error });
  }
}

export async function rejectStagingItem(stagingId: number) {
  try {
    await ensureSeeded();
    const [updated] = await db
      .update(ingestionStaging)
      .set({ reviewStatus: 'Rejected' })
      .where(eq(ingestionStaging.id, stagingId))
      .returning();
    return updated ?? null;
  } catch (error) {
    console.error('Database update failed (rejectStagingItem):', error);
    throw new Error('Failed to reject staging item.', { cause: error });
  }
}

export async function batchActionStagingItems(input: {
  ids: number[];
  action: 'approve' | 'reject';
  confidenceStatus?: 'Verified' | 'Disputed' | 'Pending Review' | 'Superseded';
  changeReason?: string;
  actorEmail?: string | null;
}) {
  try {
    await ensureSeeded();
    const succeeded: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const stagingId of input.ids) {
      const rows = await db
        .select()
        .from(ingestionStaging)
        .where(eq(ingestionStaging.id, stagingId))
        .limit(1);

      if (rows.length === 0) {
        skipped.push({ id: stagingId, reason: 'Staging item not found.' });
        continue;
      }

      const item = rows[0];
      if (item.reviewStatus !== 'Needs Review') {
        skipped.push({ id: stagingId, reason: `Already ${item.reviewStatus}.` });
        continue;
      }

      if (input.action === 'reject') {
        await rejectStagingItem(stagingId);
        succeeded.push(stagingId);
        continue;
      }

      if (!item.matchedSourceId) {
        skipped.push({
          id: stagingId,
          reason: `Unmatched source "${item.sourceNameDetected}" — assign a source individually before approving.`,
        });
        continue;
      }

      await approveStagingItem(stagingId, {
        sourceId: item.matchedSourceId,
        periodType: item.periodType as 'Monthly' | 'Yearly',
        periodValue: item.periodValue,
        count: item.extractedCount,
        confidenceStatus: input.confidenceStatus || 'Verified',
        changeReason:
          input.changeReason?.trim() ||
          `Batch approved from ingestion queue (${item.documentRef}).`,
        actorEmail: input.actorEmail ?? null,
      });
      succeeded.push(stagingId);
    }

    return {
      action: input.action,
      succeededCount: succeeded.length,
      succeededIds: succeeded,
      skipped,
    };
  } catch (error) {
    console.error('Database batch action failed (batchActionStagingItems):', error);
    throw new Error('Failed to process batch staging action.', { cause: error });
  }
}

export async function listContextMarkers() {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(contextMarkers)
      .orderBy(asc(contextMarkers.periodValue), asc(contextMarkers.id));
    return rows;
  } catch (error) {
    console.error('Database query failed (listContextMarkers):', error);
    throw new Error('Failed to load context markers.', { cause: error });
  }
}

export async function createContextMarker(input: {
  periodValue: string;
  title: string;
  category: string;
  notes?: string;
  createdByEmail?: string | null;
}) {
  try {
    await ensureSeeded();
    const [created] = await db
      .insert(contextMarkers)
      .values({
        periodValue: input.periodValue.trim(),
        title: input.title.trim(),
        category: input.category,
        notes: input.notes?.trim() || '',
        createdByEmail: input.createdByEmail ?? null,
      })
      .returning();
    return created;
  } catch (error) {
    console.error('Database insert failed (createContextMarker):', error);
    throw new Error('Failed to save context marker.', { cause: error });
  }
}

export async function deleteContextMarker(markerId: number) {
  try {
    await ensureSeeded();
    const deleted = await db
      .delete(contextMarkers)
      .where(eq(contextMarkers.id, markerId))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database delete failed (deleteContextMarker):', error);
    throw new Error('Failed to delete context marker.', { cause: error });
  }
}

