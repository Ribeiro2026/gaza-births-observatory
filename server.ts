import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import {
  approveStagingItem,
  createOrUpdateReport,
  createSource,
  deleteSource,
  getReportWithRevisions,
  listRecentRevisions,
  listReports,
  listSources,
  listStagingQueue,
  overrideReportById,
  rejectStagingItem,
  stageExtractedRecords,
} from './src/db/repository.ts';
import { AuthRequest, requireOwnerAuth } from './src/middleware/auth.ts';
import {
  extractBirthStatsWithGemini,
  fetchPublicUrlContent,
} from './src/services/gemini-extractor.ts';
import { SCRAPER_CRON_TEMPLATE } from './src/services/scraper-template.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isHttpUrl = (val: string) => {
  try {
    const u = new URL(val);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const createSourceSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum([
    'Government',
    'Multilateral Agency',
    'News Media',
    'Social Media Channel',
  ]),
  urlOrHandle: z.string().min(2).max(300),
  credibilityTier: z.enum([
    'Tier 1 - Primary Registry',
    'Tier 2 - Multilateral',
    'Tier 3 - Media / Secondary',
  ]),
  description: z.string().max(600).optional(),
  seriesColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const createReportSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
  periodType: z.enum(['Monthly', 'Yearly']),
  periodValue: z
    .string()
    .regex(/^(\d{4}|\d{4}-(0[1-9]|1[0-2]))$/, 'Use YYYY for Yearly or YYYY-MM for Monthly'),
  count: z.coerce.number().int().min(1).max(500000),
  publicationDate: z.string().min(4),
  sourceUrl: z.string().refine(isHttpUrl, 'Must be a valid http:// or https:// URL'),
  rawTextSnippet: z.string().min(5).max(3000),
  documentRef: z.string().min(2).max(160),
  confidenceStatus: z.enum(['Pending Review', 'Verified', 'Disputed', 'Superseded']),
  changeReason: z.string().max(500).optional(),
});

const overrideReportSchema = z.object({
  count: z.coerce.number().int().min(1).max(500000),
  confidenceStatus: z.enum(['Pending Review', 'Verified', 'Disputed', 'Superseded']),
  sourceUrl: z
    .string()
    .refine(isHttpUrl, 'Must be a valid http:// or https:// URL')
    .optional(),
  rawTextSnippet: z.string().min(5).max(3000).optional(),
  documentRef: z.string().min(2).max(160).optional(),
  publicationDate: z.string().optional(),
  changeReason: z.string().min(3, 'Provide a clear justification note for the audit log').max(500),
});

const extractTextSchema = z.object({
  rawText: z.string().min(15).max(20000),
  sourceUrl: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : 'https://archive.observatory.local/manual-paste')),
  sourceHint: z.string().max(120).optional(),
});

const fetchUrlSchema = z.object({
  url: z.string().refine(isHttpUrl, 'Must be a valid http:// or https:// URL'),
  sourceHint: z.string().max(120).optional(),
});

const approveStagingSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
  periodType: z.enum(['Monthly', 'Yearly']),
  periodValue: z.string().regex(/^(\d{4}|\d{4}-(0[1-9]|1[0-2]))$/),
  count: z.coerce.number().int().min(1).max(500000),
  confidenceStatus: z.enum(['Pending Review', 'Verified', 'Disputed', 'Superseded']),
  changeReason: z.string().max(500).optional(),
});

function parseDateSafe(input: string): Date {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Current authenticated owner profile
  app.get('/api/me', requireOwnerAuth, (req: AuthRequest, res: Response) => {
    res.json({
      uid: req.user?.uid,
      email: req.user?.email,
      displayName: req.user?.name || req.user?.email,
      role: req.user?.role || 'admin',
      isOwner: true,
    });
  });

  // Sources CRUD
  app.get('/api/sources', async (_req: Request, res: Response) => {
    try {
      const data = await listSources();
      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sources';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sources', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const parsed = createSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid source payload.',
      });
    }
    try {
      const created = await createSource(parsed.data);
      return res.status(201).json(created);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create source';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/sources/:id', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const sourceId = Number(req.params.id);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      return res.status(400).json({ error: 'Invalid source identifier.' });
    }
    try {
      const result = await deleteSource(sourceId);
      if (!result) {
        return res.status(404).json({ error: 'Source not found.' });
      }
      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to remove source';
      return res.status(500).json({ error: message });
    }
  });

  // Birth Reports CRUD & Filtering
  app.get('/api/reports', async (req: Request, res: Response) => {
    try {
      const sourceIdParam = req.query.sourceId ? Number(req.query.sourceId) : undefined;
      const data = await listReports({
        periodType: typeof req.query.periodType === 'string' ? req.query.periodType : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        month: typeof req.query.month === 'string' ? req.query.month : undefined,
        sourceId:
          sourceIdParam && Number.isInteger(sourceIdParam) && sourceIdParam > 0
            ? sourceIdParam
            : undefined,
        sourceType: typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined,
        confidenceStatus:
          typeof req.query.confidenceStatus === 'string'
            ? req.query.confidenceStatus
            : undefined,
        publishedFrom:
          typeof req.query.publishedFrom === 'string' ? req.query.publishedFrom : undefined,
        publishedTo:
          typeof req.query.publishedTo === 'string' ? req.query.publishedTo : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load reports';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/reports/:id', async (req: Request, res: Response) => {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ error: 'Invalid report identifier.' });
    }
    try {
      const detail = await getReportWithRevisions(reportId);
      if (!detail) {
        return res.status(404).json({ error: 'Report not found.' });
      }
      return res.json(detail);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load report detail';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/reports', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid report payload.',
      });
    }
    try {
      const result = await createOrUpdateReport({
        ...parsed.data,
        publicationDate: parseDateSafe(parsed.data.publicationDate),
        detectedBy: 'Manual Override',
        actorEmail: req.user?.email ?? null,
      });
      return res.status(result.action === 'created' ? 201 : 200).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create report';
      return res.status(500).json({ error: message });
    }
  });

  app.patch('/api/reports/:id', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ error: 'Invalid report identifier.' });
    }
    const parsed = overrideReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid override payload.',
      });
    }
    try {
      const updated = await overrideReportById(reportId, {
        ...parsed.data,
        publicationDate: parsed.data.publicationDate
          ? parseDateSafe(parsed.data.publicationDate)
          : undefined,
        actorEmail: req.user?.email ?? null,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Report not found.' });
      }
      return res.json(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update report';
      return res.status(500).json({ error: message });
    }
  });

  // Revision Audit Trail
  app.get('/api/revisions', async (req: Request, res: Response) => {
    try {
      const period = typeof req.query.period === 'string' ? req.query.period : undefined;
      const data = await listRecentRevisions(period);
      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load revision logs';
      res.status(500).json({ error: message });
    }
  });

  // Staging Queue & Automated Ingestion Pipeline (Owner Only)
  app.get('/api/staging', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const data = await listStagingQueue(status);
      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load staging queue';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ingest/extract-text', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const parsed = extractTextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Provide at least 15 characters of text to parse.',
      });
    }
    try {
      const observations = await extractBirthStatsWithGemini({
        rawText: parsed.data.rawText,
        sourceUrl: parsed.data.sourceUrl,
        sourceHint: parsed.data.sourceHint,
      });

      if (observations.length === 0) {
        return res.json({
          extractedCount: 0,
          stagedItems: [],
          message: 'No explicit Gaza birth counts tied to a month or year were found in the supplied text.',
        });
      }

      const stagedItems = await stageExtractedRecords(
        observations.map((obs) => ({
          sourceNameDetected: obs.suggested_source,
          periodType: obs.period_type,
          periodValue: obs.period,
          extractedCount: obs.count,
          publicationDate: parseDateSafe(obs.source_date),
          sourceUrl: parsed.data.sourceUrl,
          rawTextSnippet: obs.snippet,
          documentRef: obs.document_ref,
          rawExtractionJson: JSON.stringify(obs, null, 2),
        }))
      );

      return res.status(201).json({
        extractedCount: stagedItems.length,
        stagedItems,
      });
    } catch (error: unknown) {
      console.error('Text extraction error:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Extraction failed while communicating with Gemini.';
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/ingest/fetch-url', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const parsed = fetchUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Provide a valid http:// or https:// URL.',
      });
    }
    try {
      const fetched = await fetchPublicUrlContent(parsed.data.url);
      const observations = await extractBirthStatsWithGemini({
        rawText: fetched.extractedText,
        sourceUrl: fetched.url,
        sourceHint: parsed.data.sourceHint,
      });

      if (observations.length === 0) {
        return res.json({
          fetchedUrl: fetched.url,
          extractedCount: 0,
          stagedItems: [],
          message:
            'Fetched the source successfully, but no explicit monthly or yearly Gaza birth counts were detected.',
        });
      }

      const stagedItems = await stageExtractedRecords(
        observations.map((obs) => ({
          sourceNameDetected: obs.suggested_source,
          periodType: obs.period_type,
          periodValue: obs.period,
          extractedCount: obs.count,
          publicationDate: parseDateSafe(obs.source_date),
          sourceUrl: fetched.url,
          rawTextSnippet: obs.snippet,
          documentRef: obs.document_ref,
          rawExtractionJson: JSON.stringify(obs, null, 2),
        }))
      );

      return res.status(201).json({
        fetchedUrl: fetched.url,
        extractedCount: stagedItems.length,
        stagedItems,
      });
    } catch (error: unknown) {
      console.error('URL ingestion error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch or parse URL.';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/staging/:id/approve', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const stagingId = Number(req.params.id);
    if (!Number.isInteger(stagingId) || stagingId <= 0) {
      return res.status(400).json({ error: 'Invalid staging item identifier.' });
    }
    const parsed = approveStagingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid approval payload.',
      });
    }
    try {
      const result = await approveStagingItem(stagingId, {
        ...parsed.data,
        actorEmail: req.user?.email ?? null,
      });
      if (!result) {
        return res.status(404).json({ error: 'Staging item not found.' });
      }
      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Approval failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/staging/:id/reject', requireOwnerAuth, async (req: AuthRequest, res: Response) => {
    const stagingId = Number(req.params.id);
    if (!Number.isInteger(stagingId) || stagingId <= 0) {
      return res.status(400).json({ error: 'Invalid staging item identifier.' });
    }
    try {
      const updated = await rejectStagingItem(stagingId);
      if (!updated) {
        return res.status(404).json({ error: 'Staging item not found.' });
      }
      return res.json(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Rejection failed.';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/ingest/template', requireOwnerAuth, (_req: AuthRequest, res: Response) => {
    res.json({
      filename: 'gaza-births-worker.ts',
      content: SCRAPER_CRON_TEMPLATE,
    });
  });

  // Frontend serving (Vite dev middleware vs production dist)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gaza Births Observatory server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
