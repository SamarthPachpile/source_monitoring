import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { localStorageService } from '../../src/storage/local-storage';
import { StoredPublication } from '../../src/regulatory/types';
import { config } from '../../src/config/env';

describe('Local File Storage & Metadata Persistence', () => {
  const testDocId = `test-${Date.now()}`;
  const testTmpFile = path.join(os.tmpdir(), `temp-${Date.now()}.html`);

  beforeEach(async () => {
    localStorageService.initDirectories();
  });

  afterEach(async () => {
    if (fs.existsSync(testTmpFile)) {
      await fs.promises.unlink(testTmpFile).catch(() => {});
    }
  });

  afterAll(async () => {
    // Clean up test document folder and metadata
    try {
      const docDir = localStorageService.getDocumentDir('IN', testDocId);
      if (fs.existsSync(docDir)) {
        await fs.promises.rm(docDir, { recursive: true, force: true });
      }
      const all = await localStorageService.getPublications();
      const filtered = all.filter((p) => p.id !== testDocId);
      await (localStorageService as any).atomicWriteJson(
        path.join(config.DATA_DIR, 'metadata', 'publications.json'),
        filtered
      );
    } catch {}
  });

  it('stores a new document file and extracted text under data/regulations/<JURISDICTION>/<ID>/', async () => {
    // Write fake downloaded file to temp
    await fs.promises.writeFile(testTmpFile, '<html><body>HTML Content Version 1</body></html>', 'utf8');

    const publication: StoredPublication = {
      id: testDocId,
      sourceKey: 'rbi',
      authority: 'RBI',
      jurisdiction: 'IN',
      title: 'Storage Unit Test Publication',
      sourceUrl: 'https://rbi.org.in/test',
      documentUrl: 'https://rbi.org.in/test.html',
      publicationDate: null,
      effectiveDate: null,
      referenceNumber: 'REF-001',
      documentType: 'Circular',
      filePath: null,
      extractedTextPath: null,
      contentHash: null,
      mimeType: null,
      fileSizeBytes: 0,
      status: 'discovered',
      currentVersion: 1,
      versions: [],
      firstDiscoveredAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastDownloadedAt: null
    };

    const { publication: updated, isNewVersion } = await localStorageService.storeDocumentFile({
      publication,
      tempFilePath: testTmpFile,
      extension: 'html',
      mimeType: 'text/html',
      newContentHash: 'hash-v1',
      fileSizeBytes: 49,
      extractedText: 'Extracted text content for v1'
    });

    expect(isNewVersion).toBe(false);
    expect(updated.currentVersion).toBe(1);
    expect(updated.filePath).toBe(`data/regulations/IN/${testDocId}/original.html`);
    expect(updated.extractedTextPath).toBe(`data/regulations/IN/${testDocId}/extracted.txt`);
    expect(updated.contentHash).toBe('hash-v1');

    // Verify files actually exist on disk
    const absOriginal = localStorageService.toAbsolutePath(updated.filePath);
    const absExtracted = localStorageService.toAbsolutePath(updated.extractedTextPath);
    expect(fs.existsSync(absOriginal!)).toBe(true);
    expect(fs.existsSync(absExtracted!)).toBe(true);
  });

  it('preserves history and versions previous file when content changes', async () => {
    const existingPub = await localStorageService.getPublicationById(testDocId);
    expect(existingPub).not.toBeNull();

    // Prepare version 2
    const v2TmpFile = path.join(os.tmpdir(), `temp-v2-${Date.now()}.html`);
    await fs.promises.writeFile(v2TmpFile, '<html><body>HTML Content Changed Version 2</body></html>', 'utf8');

    const { publication: v2Updated, isNewVersion } = await localStorageService.storeDocumentFile({
      publication: existingPub!,
      tempFilePath: v2TmpFile,
      extension: 'html',
      mimeType: 'text/html',
      newContentHash: 'hash-v2-changed',
      fileSizeBytes: 57,
      extractedText: 'Extracted text content for v2'
    });

    expect(isNewVersion).toBe(true);
    expect(v2Updated.currentVersion).toBe(2);
    expect(v2Updated.versions.length).toBe(1);
    expect(v2Updated.versions[0].version).toBe(1);
    expect(v2Updated.versions[0].contentHash).toBe('hash-v1');

    // Check v1 was archived
    const v1Path = localStorageService.toAbsolutePath(v2Updated.versions[0].filePath);
    expect(fs.existsSync(v1Path!)).toBe(true);
  });

  it('backs up corrupted metadata file and does not silently wipe data', async () => {
    const testMetaFile = path.join(config.DATA_DIR, 'metadata', 'test-corrupt.json');
    // Write invalid JSON
    await fs.promises.writeFile(testMetaFile, '{ this is corrupted invalid json content !!!', 'utf8');

    // safeReadJson should throw an error and make a .corrupted.*.bak backup
    await expect(
      (localStorageService as any).safeReadJson(testMetaFile, [])
    ).rejects.toThrow(/Malformed metadata file/);

    // Verify backup file exists
    const dirFiles = await fs.promises.readdir(path.join(config.DATA_DIR, 'metadata'));
    const backupFound = dirFiles.some((f) => f.startsWith('test-corrupt.json.corrupted.'));
    expect(backupFound).toBe(true);

    // Clean up
    await fs.promises.unlink(testMetaFile);
    for (const f of dirFiles) {
      if (f.startsWith('test-corrupt.json.corrupted.')) {
        await fs.promises.unlink(path.join(config.DATA_DIR, 'metadata', f));
      }
    }
  });

  it('computes filesystem storage statistics accurately', async () => {
    const stats = await localStorageService.getStorageStats();
    expect(stats.totalStoredPublications).toBeGreaterThan(0);
    expect(stats.totalDownloadedFiles).toBeGreaterThan(0);
    expect(stats.totalStorageSizeBytes).toBeGreaterThan(0);
    expect(stats.totalDocumentVersions).toBeGreaterThan(0);
  });
});
