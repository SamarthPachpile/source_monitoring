import fs from 'fs';
import path from 'path';
import { config, PROJECT_ROOT } from '../config/env';
import {
  StoredPublication,
  SourceHealth,
  MonitoringRun,
  StorageStats,
  PublicationVersion
} from '../regulatory/types';
import { logger } from '../utils/logger';
import { assertSafePath, sanitizePathComponent } from '../utils/url-validation';
import { NotFoundError, AppError } from '../utils/errors';

export class LocalStorageService {
  private static instance: LocalStorageService;
  private writeLock: Promise<void> = Promise.resolve();

  private constructor() {
    this.initDirectories();
  }

  public static getInstance(): LocalStorageService {
    if (!LocalStorageService.instance) {
      LocalStorageService.instance = new LocalStorageService();
    }
    return LocalStorageService.instance;
  }

  /**
   * Ensure required folder hierarchy exists
   */
  public initDirectories(): void {
    const dirs = [
      config.DATA_DIR,
      config.REGULATIONS_DIR,
      config.METADATA_DIR,
      config.EXTRACTED_DIR,
      config.LOGS_DIR,
      path.join(config.REGULATIONS_DIR, 'SA'),
      path.join(config.REGULATIONS_DIR, 'AE'),
      path.join(config.REGULATIONS_DIR, 'IN'),
      path.join(config.REGULATIONS_DIR, 'KE')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Queue file writes sequentially to prevent concurrent read-modify-write collisions
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const nextLock = this.writeLock.then(async () => {
      try {
        return await fn();
      } catch (err) {
        throw err;
      }
    });
    this.writeLock = nextLock.then(() => {}).catch(() => {});
    return nextLock;
  }

  /**
   * Atomically write JSON data to file with temporary file & rename
   */
  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const jsonStr = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(tmpPath, jsonStr, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  /**
   * Safe JSON file read with corruption handling and backup
   */
  private async safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      if (!content.trim()) {
        return fallback;
      }
      return JSON.parse(content) as T;
    } catch (err: any) {
      logger.error({ filePath, error: err.message }, 'Failed to parse JSON file, backing up corrupted file');
      const backupPath = `${filePath}.corrupted.${Date.now()}.bak`;
      try {
        await fs.promises.copyFile(filePath, backupPath);
        logger.warn({ filePath, backupPath }, 'Corrupted file preserved at backup path');
      } catch (copyErr: any) {
        logger.error({ error: copyErr.message }, 'Failed to backup corrupted JSON file');
      }
      // Do not overwrite, rethrow or return fallback if not strictly required to avoid silent wipe
      throw new AppError(`Malformed metadata file at ${filePath}: ${err.message}. Corrupted file preserved.`);
    }
  }

  // Paths
  private get publicationsIndexPath(): string {
    return path.join(config.METADATA_DIR, 'publications.json');
  }

  private get sourcesIndexPath(): string {
    return path.join(config.METADATA_DIR, 'sources.json');
  }

  private get runsIndexPath(): string {
    return path.join(config.METADATA_DIR, 'monitoring-runs.json');
  }

  public getDocumentDir(jurisdiction: string, documentId: string): string {
    const safeJurisdiction = sanitizePathComponent(jurisdiction.toUpperCase());
    const safeDocId = sanitizePathComponent(documentId);
    const targetDir = path.join(config.REGULATIONS_DIR, safeJurisdiction, safeDocId);
    return assertSafePath(targetDir, config.REGULATIONS_DIR);
  }

  public toRelativePath(absolutePath: string | null): string | null {
    if (!absolutePath) return null;
    return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, '/');
  }

  public toAbsolutePath(relativePath: string | null): string | null {
    if (!relativePath) return null;
    return path.resolve(PROJECT_ROOT, relativePath);
  }

  /**
   * Check whether the document's directory and files actually exist on disk
   */
  public verifyDocumentFilesExist(publication: StoredPublication): boolean {
    if (!publication.filePath) return false;
    const absPath = this.toAbsolutePath(publication.filePath);
    if (!absPath || !fs.existsSync(absPath)) return false;

    // Check directory
    const docDir = this.getDocumentDir(publication.jurisdiction, publication.id);
    if (!fs.existsSync(docDir)) return false;

    // Check extracted text if defined
    if (publication.extractedTextPath) {
      const absExtPath = this.toAbsolutePath(publication.extractedTextPath);
      if (!absExtPath || !fs.existsSync(absExtPath)) return false;
    }

    return true;
  }

  /**
   * Reconcile metadata with physical disk state:
   * If a document's folder or file was deleted from disk, flag it as 'missing_locally' so it gets re-downloaded
   */
  public async reconcileWithDisk(): Promise<{ missingCount: number }> {
    return this.withLock(async () => {
      let publications: StoredPublication[] = [];
      try {
        publications = await this.safeReadJson<StoredPublication[]>(this.publicationsIndexPath, []);
      } catch {
        return { missingCount: 0 };
      }

      let modified = false;
      let missingCount = 0;

      for (const pub of publications) {
        if (pub.status === 'downloaded' && pub.filePath) {
          const exists = this.verifyDocumentFilesExist(pub);
          if (!exists) {
            pub.status = 'missing_locally';
            modified = true;
            missingCount++;
            logger.warn(
              { docId: pub.id, authority: pub.authority, path: pub.filePath },
              'Document folder/file missing on disk. Marked as missing_locally for automatic re-ingestion.'
            );
          }
        } else if (pub.status === 'missing_locally' && pub.filePath) {
          const exists = this.verifyDocumentFilesExist(pub);
          if (exists) {
            pub.status = 'downloaded';
            modified = true;
          } else {
            missingCount++;
          }
        }
      }

      if (modified) {
        await this.atomicWriteJson(this.publicationsIndexPath, publications);
      }

      return { missingCount };
    });
  }

  // --- Publications ---

  public async getPublications(): Promise<StoredPublication[]> {
    return this.withLock(async () => {
      try {
        return await this.safeReadJson<StoredPublication[]>(this.publicationsIndexPath, []);
      } catch (err: any) {
        if (err.message.includes('Malformed metadata file')) {
          throw err;
        }
        return [];
      }
    });
  }

  public async getPublicationById(id: string): Promise<StoredPublication | null> {
    const all = await this.getPublications();
    return all.find((p) => p.id === id) || null;
  }

  public async savePublication(pub: StoredPublication): Promise<void> {
    return this.withLock(async () => {
      let all: StoredPublication[] = [];
      try {
        all = await this.safeReadJson<StoredPublication[]>(this.publicationsIndexPath, []);
      } catch {
        all = [];
      }

      const index = all.findIndex((p) => p.id === pub.id);
      if (index >= 0) {
        all[index] = pub;
      } else {
        all.push(pub);
      }

      await this.atomicWriteJson(this.publicationsIndexPath, all);

      // Also write individual metadata.json in the publication directory if jurisdiction and id exist
      try {
        const docDir = this.getDocumentDir(pub.jurisdiction, pub.id);
        if (!fs.existsSync(docDir)) {
          fs.mkdirSync(docDir, { recursive: true });
        }
        await this.atomicWriteJson(path.join(docDir, 'metadata.json'), pub);
      } catch (err: any) {
        logger.warn({ docId: pub.id, error: err.message }, 'Failed to write individual document metadata.json');
      }
    });
  }

  // --- Document File Storage & Versioning ---

  /**
   * Save a newly downloaded document file and handle versioning if changed
   */
  public async storeDocumentFile(params: {
    publication: StoredPublication;
    tempFilePath: string;
    extension: string;
    mimeType: string;
    newContentHash: string;
    fileSizeBytes: number;
    extractedText?: string;
  }): Promise<{ publication: StoredPublication; isNewVersion: boolean }> {
    const { publication, tempFilePath, extension, mimeType, newContentHash, fileSizeBytes, extractedText } = params;
    const docDir = this.getDocumentDir(publication.jurisdiction, publication.id);
    const versionsDir = path.join(docDir, 'versions');
    const extractedVersionsDir = path.join(docDir, 'extracted');

    if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });
    if (!fs.existsSync(extractedVersionsDir)) fs.mkdirSync(extractedVersionsDir, { recursive: true });

    const originalFileName = `original.${extension}`;
    const originalFilePath = path.join(docDir, originalFileName);
    const extractedFilePath = path.join(docDir, 'extracted.txt');

    let isNewVersion = false;
    let nextVersionNum = publication.currentVersion || 1;

    // Check if original file exists and has content
    if (fs.existsSync(originalFilePath) && publication.contentHash && publication.contentHash !== newContentHash) {
      // Content changed! Version older version
      isNewVersion = true;
      const oldVer = publication.currentVersion || 1;
      const oldExt = publication.filePath ? path.extname(publication.filePath).replace('.', '') : 'pdf';
      const versionTarget = path.join(versionsDir, `v${oldVer}.${oldExt}`);
      
      // Move existing original to versions/v{N}.ext
      await fs.promises.copyFile(originalFilePath, versionTarget);

      // Move existing extracted.txt to extracted/v{N}.txt if it exists
      if (fs.existsSync(extractedFilePath)) {
        await fs.promises.copyFile(extractedFilePath, path.join(extractedVersionsDir, `v${oldVer}.txt`));
      }

      // Record in versions array
      const existingVersions = publication.versions || [];
      existingVersions.push({
        version: oldVer,
        contentHash: publication.contentHash,
        filePath: this.toRelativePath(versionTarget)!,
        extractedTextPath: fs.existsSync(path.join(extractedVersionsDir, `v${oldVer}.txt`))
          ? this.toRelativePath(path.join(extractedVersionsDir, `v${oldVer}.txt`))
          : null,
        downloadedAt: publication.lastDownloadedAt || publication.firstDiscoveredAt,
        fileSizeBytes: publication.fileSizeBytes || 0
      });

      publication.versions = existingVersions;
      nextVersionNum = oldVer + 1;
    }

    // Atomically move temp file to originalFilePath
    await fs.promises.copyFile(tempFilePath, originalFilePath);
    await fs.promises.unlink(tempFilePath).catch(() => {});

    // Save extracted text if available
    let relativeExtractedPath: string | null = null;
    if (extractedText !== undefined) {
      await fs.promises.writeFile(extractedFilePath, extractedText, 'utf8');
      relativeExtractedPath = this.toRelativePath(extractedFilePath);
    }

    // Update publication metadata
    publication.filePath = this.toRelativePath(originalFilePath);
    publication.extractedTextPath = relativeExtractedPath || publication.extractedTextPath;
    publication.contentHash = newContentHash;
    publication.mimeType = mimeType;
    publication.fileSizeBytes = fileSizeBytes;
    publication.currentVersion = nextVersionNum;
    publication.lastDownloadedAt = new Date().toISOString();
    publication.lastCheckedAt = new Date().toISOString();
    publication.status = 'downloaded';

    await this.savePublication(publication);

    return { publication, isNewVersion };
  }

  // --- Sources Health ---

  public async getSources(): Promise<SourceHealth[]> {
    return this.withLock(async () => {
      try {
        return await this.safeReadJson<SourceHealth[]>(this.sourcesIndexPath, []);
      } catch {
        return [];
      }
    });
  }

  public async saveSources(sources: SourceHealth[]): Promise<void> {
    return this.withLock(async () => {
      await this.atomicWriteJson(this.sourcesIndexPath, sources);
    });
  }

  public async updateSourceHealth(
    sourceKey: string,
    update: Partial<SourceHealth>
  ): Promise<void> {
    return this.withLock(async () => {
      let sources: SourceHealth[] = [];
      try {
        sources = await this.safeReadJson<SourceHealth[]>(this.sourcesIndexPath, []);
      } catch {
        sources = [];
      }

      const index = sources.findIndex((s) => s.sourceKey.toLowerCase() === sourceKey.toLowerCase());
      if (index >= 0) {
        sources[index] = { ...sources[index], ...update };
      } else if (update.authority && update.jurisdiction) {
        sources.push({
          sourceKey,
          authority: update.authority,
          jurisdiction: update.jurisdiction,
          region: update.region || '',
          startingUrl: update.startingUrl || '',
          enabled: update.enabled !== false,
          lastCheckedAt: update.lastCheckedAt || null,
          lastSuccessfulAt: update.lastSuccessfulAt || null,
          status: update.status || 'not_checked',
          lastError: update.lastError || null
        });
      }

      await this.atomicWriteJson(this.sourcesIndexPath, sources);
    });
  }

  // --- Monitoring Runs ---

  public async getMonitoringRuns(limit = 20, offset = 0): Promise<{ runs: MonitoringRun[]; total: number }> {
    return this.withLock(async () => {
      let runs: MonitoringRun[] = [];
      try {
        runs = await this.safeReadJson<MonitoringRun[]>(this.runsIndexPath, []);
      } catch {
        runs = [];
      }
      // Sort newest first
      runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      const paginated = runs.slice(offset, offset + limit);
      return { runs: paginated, total: runs.length };
    });
  }

  public async getMonitoringRunById(runId: string): Promise<MonitoringRun | null> {
    return this.withLock(async () => {
      let runs: MonitoringRun[] = [];
      try {
        runs = await this.safeReadJson<MonitoringRun[]>(this.runsIndexPath, []);
      } catch {
        runs = [];
      }
      return runs.find((r) => r.id === runId) || null;
    });
  }

  public async saveMonitoringRun(run: MonitoringRun): Promise<void> {
    return this.withLock(async () => {
      let runs: MonitoringRun[] = [];
      try {
        runs = await this.safeReadJson<MonitoringRun[]>(this.runsIndexPath, []);
      } catch {
        runs = [];
      }

      const index = runs.findIndex((r) => r.id === run.id);
      if (index >= 0) {
        runs[index] = run;
      } else {
        runs.unshift(run); // Add latest to front
      }

      // Keep recent 100 runs
      if (runs.length > 100) {
        runs = runs.slice(0, 100);
      }

      await this.atomicWriteJson(this.runsIndexPath, runs);
    });
  }

  // --- Statistics ---

  public async getStorageStats(): Promise<StorageStats> {
    const publications = await this.getPublications();

    let totalDownloadedFiles = 0;
    let totalExtractedTextFiles = 0;
    let totalStorageSizeBytes = 0;
    let missingLocallyCount = 0;
    let failedDownloadsCount = 0;
    let failedExtractionsCount = 0;
    let totalDocumentVersions = 0;

    for (const pub of publications) {
      if (pub.filePath) {
        const fullDocPath = this.toAbsolutePath(pub.filePath);
        if (fullDocPath && fs.existsSync(fullDocPath)) {
          totalDownloadedFiles++;
          try {
            const stat = fs.statSync(fullDocPath);
            totalStorageSizeBytes += stat.size;
          } catch {}
        } else if (pub.status === 'downloaded' || pub.status === 'missing_locally') {
          missingLocallyCount++;
        }
      }

      if (pub.extractedTextPath) {
        const fullExtPath = this.toAbsolutePath(pub.extractedTextPath);
        if (fullExtPath && fs.existsSync(fullExtPath)) {
          totalExtractedTextFiles++;
          try {
            const stat = fs.statSync(fullExtPath);
            totalStorageSizeBytes += stat.size;
          } catch {}
        }
      }

      if (pub.status === 'download_failed') {
        failedDownloadsCount++;
      }
      if (pub.status === 'extraction_failed') {
        failedExtractionsCount++;
      }

      // Add versions
      if (pub.versions && Array.isArray(pub.versions)) {
        totalDocumentVersions += pub.versions.length;
        for (const ver of pub.versions) {
          if (ver.filePath) {
            const vPath = this.toAbsolutePath(ver.filePath);
            if (vPath && fs.existsSync(vPath)) {
              totalDownloadedFiles++;
              try {
                totalStorageSizeBytes += fs.statSync(vPath).size;
              } catch {}
            }
          }
          if (ver.extractedTextPath) {
            const vTextPath = this.toAbsolutePath(ver.extractedTextPath);
            if (vTextPath && fs.existsSync(vTextPath)) {
              totalExtractedTextFiles++;
              try {
                totalStorageSizeBytes += fs.statSync(vTextPath).size;
              } catch {}
            }
          }
        }
      }
    }

    return {
      totalStoredPublications: publications.length,
      totalDownloadedFiles,
      totalExtractedTextFiles,
      totalStorageSizeBytes,
      missingLocallyCount,
      failedDownloadsCount,
      failedExtractionsCount,
      totalDocumentVersions
    };
  }
}

export const localStorageService = LocalStorageService.getInstance();
