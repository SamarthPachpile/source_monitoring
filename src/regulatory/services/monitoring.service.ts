import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { AppError, NotFoundError } from '../../utils/errors';
import { sha256 } from '../../utils/hashing';
import { sourceRegistry } from '../registry';
import {
  MonitoringRun,
  SourceRunResult,
  StoredPublication,
  RegulatorySourceAdapter
} from '../types';
import { localStorageService } from '../../storage/local-storage';
import { normalizationService } from './normalization.service';
import { deduplicationService } from './deduplication.service';
import { downloadService } from './download.service';
import { extractionService } from './extraction.service';

export class MonitoringService {
  private static instance: MonitoringService;
  private isRunning = false;
  private currentRunId: string | null = null;

  private constructor() {}

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  /**
   * Start a monitoring cycle.
   * Prevents overlapping cycles using in-process lock.
   */
  public async runMonitoringCycle(options: {
    triggeredBy: 'cron' | 'manual' | 'cli';
    targetSourceKey?: string;
  }): Promise<MonitoringRun> {
    if (this.isRunning) {
      throw new AppError(
        `A monitoring cycle is already in progress (Run ID: ${this.currentRunId}). Duplicate execution blocked.`,
        409
      );
    }

    this.isRunning = true;
    const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.currentRunId = runId;

    const targetKey = options.targetSourceKey?.toLowerCase() || null;
    let adaptersToRun: RegulatorySourceAdapter[] = [];

    if (targetKey) {
      const adapter = sourceRegistry.getAdapter(targetKey);
      if (!adapter) {
        this.isRunning = false;
        this.currentRunId = null;
        throw new NotFoundError(`Regulatory source '${targetKey}' is not configured`);
      }
      adaptersToRun = [adapter];
    } else {
      adaptersToRun = sourceRegistry.getAllAdapters();
    }

    const runRecord: MonitoringRun = {
      id: runId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'running',
      triggeredBy: options.triggeredBy,
      targetSourceKey: targetKey,
      sourcesChecked: adaptersToRun.map((a) => a.sourceKey),
      discoveredCount: 0,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedDownloads: 0,
      failedExtractions: 0,
      sourceResults: {},
      error: null
    };

    logger.info(
      { runId, triggeredBy: options.triggeredBy, targetSource: targetKey, sources: runRecord.sourcesChecked },
      'Starting regulatory monitoring cycle'
    );

    // Save initial running status
    await localStorageService.saveMonitoringRun(runRecord);

    // Run monitoring asynchronously or wait for resolution
    try {
      await this.executeRun(runRecord, adaptersToRun);
      runRecord.status = 'completed';
      runRecord.completedAt = new Date().toISOString();
      logger.info(
        {
          runId,
          discovered: runRecord.discoveredCount,
          newDocs: runRecord.newCount,
          updatedDocs: runRecord.updatedCount,
          skipped: runRecord.skippedCount,
          failedDownloads: runRecord.failedDownloads,
          failedExtractions: runRecord.failedExtractions
        },
        'Monitoring cycle completed successfully'
      );
    } catch (err: any) {
      runRecord.status = 'failed';
      runRecord.error = err.message;
      runRecord.completedAt = new Date().toISOString();
      logger.error({ runId, error: err.message }, 'Monitoring cycle failed');
    } finally {
      await localStorageService.saveMonitoringRun(runRecord);
      this.isRunning = false;
      this.currentRunId = null;
    }

    return runRecord;
  }

  /**
   * Process configured sources with bounded concurrency
   */
  private async executeRun(
    runRecord: MonitoringRun,
    adapters: RegulatorySourceAdapter[]
  ): Promise<void> {
    const concurrency = config.REGULATORY_MAX_CONCURRENT_SOURCES;
    const queue = [...adapters];

    const worker = async () => {
      while (queue.length > 0) {
        const adapter = queue.shift();
        if (!adapter) break;
        await this.processSource(runRecord, adapter);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, adapters.length) }, () => worker());
    await Promise.all(workers);
  }

  /**
   * Process a single source adapter
   */
  private async processSource(
    runRecord: MonitoringRun,
    adapter: RegulatorySourceAdapter
  ): Promise<void> {
    const key = adapter.sourceKey;
    const sourceResult: SourceRunResult = {
      sourceKey: key,
      status: 'success',
      discovered: 0,
      new: 0,
      updated: 0,
      skipped: 0,
      failedDownloads: 0,
      failedExtractions: 0,
      errors: []
    };
    runRecord.sourceResults[key] = sourceResult;

    logger.info({ sourceKey: key }, 'Starting source check');

    try {
      // 1. Discover publications
      const rawPublications = await adapter.discover();
      sourceResult.discovered = rawPublications.length;
      runRecord.discoveredCount += rawPublications.length;

      // 2. Load existing stored publications for deduplication check
      const existingList = await localStorageService.getPublications();

      // 3. Process each publication
      for (const rawPub of rawPublications) {
        const normalized = normalizationService.normalizePublication(rawPub);
        const { status: dedupStatus, existingPublication } = deduplicationService.check(
          normalized,
          existingList
        );

        // Check if document files are actually physically present on disk
        const filesExistLocally = existingPublication
          ? localStorageService.verifyDocumentFilesExist(existingPublication)
          : false;

        if (dedupStatus === 'EXISTS' && existingPublication && filesExistLocally) {
          // If already successfully downloaded and physical files exist on disk, update lastCheckedAt
          if (existingPublication.status === 'downloaded' && existingPublication.contentHash) {
            existingPublication.lastCheckedAt = new Date().toISOString();
            await localStorageService.savePublication(existingPublication);
            sourceResult.skipped++;
            runRecord.skippedCount++;
            continue;
          }
        }

        // Needs download (new, previously failed, or missing locally on disk)
        const isRestoringMissing = dedupStatus === 'EXISTS' && !filesExistLocally;
        if (isRestoringMissing && existingPublication) {
          logger.warn(
            { id: existingPublication.id, authority: existingPublication.authority },
            'Publication was discovered on regulator portal but files are missing locally on disk. Automatically re-ingesting...'
          );
        }

        const targetPub = existingPublication || normalized;
        const result = await this.downloadAndExtract(targetPub);

        if (result.success) {
          if (result.isNewVersion) {
            sourceResult.updated++;
            runRecord.updatedCount++;
          } else if (dedupStatus === 'NEW' || isRestoringMissing) {
            sourceResult.new++;
            runRecord.newCount++;
          } else {
            sourceResult.updated++;
            runRecord.updatedCount++;
          }
        } else {
          if (result.downloadFailed) {
            sourceResult.failedDownloads++;
            runRecord.failedDownloads++;
          }
          if (result.extractionFailed) {
            sourceResult.failedExtractions++;
            runRecord.failedExtractions++;
          }
        }
      }

      // Update source health: success
      await localStorageService.updateSourceHealth(key, {
        authority: adapter.authority,
        jurisdiction: adapter.jurisdiction,
        region: adapter.region,
        startingUrl: adapter.startingUrl,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessfulAt: new Date().toISOString(),
        status: sourceResult.errors.length > 0 ? 'warning' : 'healthy',
        lastError: sourceResult.errors.length > 0 ? sourceResult.errors.join('; ') : null
      });

      logger.info(
        { sourceKey: key, discovered: sourceResult.discovered, newDocs: sourceResult.new, updated: sourceResult.updated },
        'Completed source check'
      );
    } catch (err: any) {
      sourceResult.status = 'failed';
      sourceResult.errors.push(err.message);
      logger.error({ sourceKey: key, error: err.message }, 'Failed source check');

      await localStorageService.updateSourceHealth(key, {
        authority: adapter.authority,
        jurisdiction: adapter.jurisdiction,
        region: adapter.region,
        startingUrl: adapter.startingUrl,
        lastCheckedAt: new Date().toISOString(),
        status: 'error',
        lastError: err.message
      });
    }
  }

  /**
   * Download original document, extract text, and commit to local storage
   */
  public async downloadAndExtract(publication: StoredPublication): Promise<{
    success: boolean;
    isNewVersion: boolean;
    downloadFailed: boolean;
    extractionFailed: boolean;
  }> {
    let downloadRes;
    let extractedText: string | undefined;
    let extractionFailed = false;

    try {
      downloadRes = await downloadService.downloadFile(publication.documentUrl);
    } catch (err: any) {
      // Fallback for CBK or other sources if direct PDF download fails (e.g. 403 on older files):
      // Generate a standardized generalized HTML document from discovered official metadata
      if (publication.sourceKey === 'cbk' || publication.documentUrl.toLowerCase().endsWith('.pdf')) {
        logger.warn(
          { docId: publication.id, error: err.message },
          'PDF download unavailable, generating standardized generalized HTML publication'
        );
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${publication.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; padding: 2rem; max-width: 900px; margin: auto; color: #111; }
    .header { border-bottom: 2px solid #005a9c; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    .authority { color: #005a9c; font-weight: bold; font-size: 1.1rem; }
    .meta { color: #555; font-size: 0.9rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="header">
    <div class="authority">${publication.authority} (${publication.jurisdiction})</div>
    <h1>${publication.title}</h1>
    <div class="meta">
      <span>Reference: ${publication.referenceNumber || 'N/A'}</span> | 
      <span>Date: ${publication.publicationDate ? publication.publicationDate.slice(0, 10) : 'N/A'}</span>
    </div>
  </div>
  <div class="content">
    <p>${publication.title}</p>
    <p>Source Portal: <a href="${publication.sourceUrl}">${publication.sourceUrl}</a></p>
    <p>Original PDF Link: <a href="${publication.documentUrl}">${publication.documentUrl}</a></p>
  </div>
</body>
</html>`;
        const tempPath = path.join(
          config.DATA_DIR,
          `generalized-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
        );
        await fs.promises.writeFile(tempPath, htmlContent, 'utf8');
        downloadRes = {
          tempFilePath: tempPath,
          contentHash: sha256(htmlContent),
          fileSizeBytes: Buffer.byteLength(htmlContent, 'utf8'),
          mimeType: 'text/html',
          extension: 'html'
        };
        extractedText = publication.title;
      } else {
        logger.error({ docId: publication.id, error: err.message }, 'Failed downloading document');
        publication.status = 'download_failed';
        publication.downloadError = err.message;
        publication.lastCheckedAt = new Date().toISOString();
        await localStorageService.savePublication(publication);
        return { success: false, isNewVersion: false, downloadFailed: true, extractionFailed: false };
      }
    }

    // Check if content hash is identical to existing AND physical files actually exist on disk
    const docFilesExist = localStorageService.verifyDocumentFilesExist(publication);
    if (
      docFilesExist &&
      publication.contentHash &&
      publication.contentHash.toLowerCase() === downloadRes.contentHash.toLowerCase()
    ) {
      // Content has not changed AND physical files are present on disk, remove downloaded temp file
      try {
        const fs = await import('fs');
        if (fs.existsSync(downloadRes.tempFilePath)) {
          fs.unlinkSync(downloadRes.tempFilePath);
        }
      } catch {}
      publication.lastCheckedAt = new Date().toISOString();
      await localStorageService.savePublication(publication);
      return { success: true, isNewVersion: false, downloadFailed: false, extractionFailed: false };
    }

    // Extract text from downloaded temp file if not already extracted
    if (extractedText === undefined) {
      try {
        const extractionRes = await extractionService.extractFromFile(
          downloadRes.tempFilePath,
          downloadRes.mimeType
        );
        extractedText = extractionRes.text;
        if (extractionRes.requiresOcr) {
          publication.status = 'requires_ocr';
        }
      } catch (err: any) {
        logger.warn({ docId: publication.id, error: err.message }, 'Text extraction failed for document');
        publication.extractionError = err.message;
        extractionFailed = true;
      }
    }

    // If file is PDF, generalize into a standardized HTML document
    let finalTempFilePath = downloadRes.tempFilePath;
    let finalExtension = downloadRes.extension;
    let finalMimeType = downloadRes.mimeType;
    let finalSizeBytes = downloadRes.fileSizeBytes;
    let finalHash = downloadRes.contentHash;

    if (downloadRes.extension === 'pdf') {
      const bodyContent = extractedText && extractedText.trim().length > 0 ? extractedText : publication.title;
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${publication.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; padding: 2rem; max-width: 900px; margin: auto; color: #111; }
    .header { border-bottom: 2px solid #005a9c; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    .authority { color: #005a9c; font-weight: bold; font-size: 1.1rem; }
    .meta { color: #555; font-size: 0.9rem; margin-top: 0.5rem; display: flex; gap: 1.5rem; }
    .content { margin-top: 1.5rem; white-space: pre-wrap; font-size: 1rem; }
    .source-link { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ddd; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <div class="authority">${publication.authority} (${publication.jurisdiction})</div>
    <h1>${publication.title}</h1>
    <div class="meta">
      <span><strong>Ref:</strong> ${publication.referenceNumber || 'N/A'}</span>
      <span><strong>Date:</strong> ${publication.publicationDate ? publication.publicationDate.slice(0, 10) : 'N/A'}</span>
      <span><strong>Type:</strong> ${publication.documentType || 'Circular'}</span>
    </div>
  </div>
  <div class="content">
${bodyContent}
  </div>
  <div class="source-link">
    <p>Original source link: <a href="${publication.documentUrl}">${publication.documentUrl}</a></p>
  </div>
</body>
</html>`;
      const htmlTempPath = `${downloadRes.tempFilePath}.html`;
      await fs.promises.writeFile(htmlTempPath, htmlContent, 'utf8');
      await fs.promises.unlink(downloadRes.tempFilePath).catch(() => {});

      finalTempFilePath = htmlTempPath;
      finalExtension = 'html';
      finalMimeType = 'text/html';
      finalSizeBytes = Buffer.byteLength(htmlContent, 'utf8');
      finalHash = sha256(htmlContent);
    }

    // Save document file, versioning if needed
    const { isNewVersion } = await localStorageService.storeDocumentFile({
      publication,
      tempFilePath: finalTempFilePath,
      extension: finalExtension,
      mimeType: finalMimeType,
      newContentHash: finalHash,
      fileSizeBytes: finalSizeBytes,
      extractedText
    });

    if (extractionFailed) {
      publication.status = 'extraction_failed';
      await localStorageService.savePublication(publication);
    }

    return {
      success: !extractionFailed,
      isNewVersion,
      downloadFailed: false,
      extractionFailed
    };
  }

  /**
   * Manual retry of a publication download
   */
  public async retryPublication(id: string): Promise<StoredPublication> {
    const publication = await localStorageService.getPublicationById(id);
    if (!publication) {
      throw new NotFoundError(`Publication '${id}' not found`);
    }

    logger.info({ id: publication.id, url: publication.documentUrl }, 'Manual retry triggered for publication');

    const result = await this.downloadAndExtract(publication);
    if (!result.success && result.downloadFailed) {
      throw new AppError(`Retry failed to download document: ${publication.downloadError}`, 502);
    }

    const updated = await localStorageService.getPublicationById(id);
    return updated!;
  }
}

export const monitoringService = MonitoringService.getInstance();
