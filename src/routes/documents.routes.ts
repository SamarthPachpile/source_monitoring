import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { localStorageService } from '../storage/local-storage';
import { monitoringService } from '../regulatory/services/monitoring.service';
import { requireApiKey } from '../middleware/auth.middleware';
import { NotFoundError, AppError, SecurityError } from '../utils/errors';
import { assertSafePath } from '../utils/url-validation';
import { config, PROJECT_ROOT } from '../config/env';

export const documentsRouter = Router();

/**
 * List publications with filtering and pagination
 */
documentsRouter.get('/regulations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      jurisdiction,
      sourceKey,
      authority,
      documentType,
      status,
      search,
      limit: rawLimit,
      offset: rawOffset
    } = req.query;

    const limit = Math.max(1, Math.min(100, parseInt(rawLimit as string, 10) || 20));
    const offset = Math.max(0, parseInt(rawOffset as string, 10) || 0);

    let list = await localStorageService.getPublications();

    // Filters
    if (jurisdiction) {
      const j = (jurisdiction as string).toUpperCase();
      list = list.filter((p) => p.jurisdiction.toUpperCase() === j);
    }
    if (sourceKey) {
      const s = (sourceKey as string).toLowerCase();
      list = list.filter((p) => p.sourceKey.toLowerCase() === s);
    }
    if (authority) {
      const a = (authority as string).toUpperCase();
      list = list.filter((p) => p.authority.toUpperCase() === a);
    }
    if (documentType) {
      const dt = (documentType as string).toLowerCase();
      list = list.filter((p) => (p.documentType || '').toLowerCase() === dt);
    }
    if (status) {
      const st = (status as string).toLowerCase();
      list = list.filter((p) => p.status.toLowerCase() === st);
    }

    // Search query
    if (search && typeof search === 'string') {
      const term = search.toLowerCase().trim();
      list = list.filter((p) => {
        const titleMatch = (p.title || '').toLowerCase().includes(term);
        const refMatch = (p.referenceNumber || '').toLowerCase().includes(term);
        if (titleMatch || refMatch) return true;

        // Search inside extracted text file if present
        if (p.extractedTextPath) {
          const absPath = localStorageService.toAbsolutePath(p.extractedTextPath);
          if (absPath && fs.existsSync(absPath)) {
            try {
              const text = fs.readFileSync(absPath, 'utf8');
              return text.toLowerCase().includes(term);
            } catch {}
          }
        }
        return false;
      });
    }

    const total = list.length;
    const paginated = list.slice(offset, offset + limit);

    res.json({
      success: true,
      data: {
        publications: paginated,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + paginated.length < total
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Storage statistics
 */
documentsRouter.get('/storage/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await localStorageService.getStorageStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get single publication details
 */
documentsRouter.get('/regulations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pubId = req.params.id as string;
    const pub = await localStorageService.getPublicationById(pubId);
    if (!pub) {
      throw new NotFoundError(`Publication '${pubId}' not found`);
    }

    res.json({
      success: true,
      data: pub
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get extracted text content
 */
documentsRouter.get('/regulations/:id/text', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pubId = req.params.id as string;
    const pub = await localStorageService.getPublicationById(pubId);
    if (!pub) {
      throw new NotFoundError(`Publication '${pubId}' not found`);
    }

    const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;
    let targetTextPath = pub.extractedTextPath;

    if (versionParam && versionParam !== pub.currentVersion) {
      const ver = (pub.versions || []).find((v) => v.version === versionParam);
      if (!ver || !ver.extractedTextPath) {
        throw new NotFoundError(`Extracted text for version ${versionParam} not found`);
      }
      targetTextPath = ver.extractedTextPath;
    }

    if (!targetTextPath) {
      throw new AppError(
        pub.status === 'extraction_failed'
          ? `Text extraction failed for this document: ${pub.extractionError || 'Unknown error'}`
          : 'Extracted text is not available for this document',
        404
      );
    }

    const absPath = localStorageService.toAbsolutePath(targetTextPath);
    if (!absPath || !fs.existsSync(absPath)) {
      throw new NotFoundError('Extracted text file is missing from disk');
    }

    const text = await fs.promises.readFile(absPath, 'utf8');

    res.json({
      success: true,
      data: {
        id: pub.id,
        version: versionParam || pub.currentVersion,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        text
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Stream/download original document file
 */
documentsRouter.get('/regulations/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pubId = req.params.id as string;
    const pub = await localStorageService.getPublicationById(pubId);
    if (!pub) {
      throw new NotFoundError(`Publication '${pubId}' not found`);
    }

    const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;
    let targetFilePath = pub.filePath;

    if (versionParam && versionParam !== pub.currentVersion) {
      const ver = (pub.versions || []).find((v) => v.version === versionParam);
      if (!ver || !ver.filePath) {
        throw new NotFoundError(`File for version ${versionParam} not found`);
      }
      targetFilePath = ver.filePath;
    }

    if (!targetFilePath) {
      throw new NotFoundError('No downloaded document file exists for this publication');
    }

    const absPath = localStorageService.toAbsolutePath(targetFilePath);
    if (!absPath || !fs.existsSync(absPath)) {
      throw new NotFoundError('Document file is missing from disk');
    }

    // Verify path safety
    assertSafePath(absPath, config.DATA_DIR);

    const ext = path.extname(absPath);
    const contentType = pub.mimeType || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
    const filename = `${pub.id}-v${versionParam || pub.currentVersion}${ext}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(absPath);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Download extracted text as a .txt file attachment
 */
documentsRouter.get(
  '/regulations/:id/download-text',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pubId = req.params.id as string;
      const pub = await localStorageService.getPublicationById(pubId);
      if (!pub) {
        throw new NotFoundError(`Publication '${pubId}' not found`);
      }

      const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;
      let targetTextPath = pub.extractedTextPath;

      if (versionParam && versionParam !== pub.currentVersion) {
        const ver = (pub.versions || []).find((v) => v.version === versionParam);
        if (!ver || !ver.extractedTextPath) {
          throw new NotFoundError(`Extracted text for version ${versionParam} not found`);
        }
        targetTextPath = ver.extractedTextPath;
      }

      if (!targetTextPath) {
        throw new NotFoundError('Extracted text is not available for this publication');
      }

      const absPath = localStorageService.toAbsolutePath(targetTextPath);
      if (!absPath || !fs.existsSync(absPath)) {
        throw new NotFoundError('Extracted text file is missing from disk');
      }

      assertSafePath(absPath, config.DATA_DIR);

      const filename = `${pub.id}-v${versionParam || pub.currentVersion}-extracted.txt`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const stream = fs.createReadStream(absPath);
      stream.on('error', (err) => next(err));
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Manually retry a failed download
 */
documentsRouter.post(
  '/regulations/:id/retry',
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pubId = req.params.id as string;
      const updated = await monitoringService.retryPublication(pubId);
      res.json({
        success: true,
        message: 'Publication download retried successfully',
        data: updated
      });
    } catch (err) {
      next(err);
    }
  }
);
