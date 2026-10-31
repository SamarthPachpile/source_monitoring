import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from '../../src/app';
import { localStorageService } from '../../src/storage/local-storage';
import { StoredPublication } from '../../src/regulatory/types';
import { config } from '../../src/config/env';

describe('REST API Endpoints for Postman Integration', () => {
  const apiKey = config.REGULATORY_API_KEY;
  let seededPubId: string;

  beforeAll(async () => {
    localStorageService.initDirectories();

    // Seed a known publication for download and text verification
    const testDocId = `in-test-doc-${Date.now()}`;
    seededPubId = testDocId;

    const seedPub: StoredPublication = {
      id: testDocId,
      sourceKey: 'rbi',
      authority: 'RBI',
      jurisdiction: 'IN',
      title: 'Monetary Policy Framework Guideline',
      sourceUrl: 'https://rbi.org.in/notice/100',
      documentUrl: 'https://rbidocs.rbi.org.in/notice100.html',
      publicationDate: '2026-10-01T00:00:00.000Z',
      effectiveDate: null,
      referenceNumber: 'RBI/2026-27/555',
      documentType: 'Guideline',
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

    // Store document file as standardized HTML
    const tempFile = path.join(os.tmpdir(), `seed-${Date.now()}.html`);
    await fs.promises.writeFile(tempFile, '<html><body>Mock HTML Body for API Integration Testing</body></html>', 'utf8');

    await localStorageService.storeDocumentFile({
      publication: seedPub,
      tempFilePath: tempFile,
      extension: 'html',
      mimeType: 'text/html',
      newContentHash: 'seed-hash-12345',
      fileSizeBytes: 70,
      extractedText: 'Extracted plain text for monetary policy framework guideline.'
    });
  });

  afterAll(async () => {
    // Clean up seeded test doc from disk and metadata
    try {
      const docDir = localStorageService.getDocumentDir('IN', seededPubId);
      if (fs.existsSync(docDir)) {
        await fs.promises.rm(docDir, { recursive: true, force: true });
      }
      const all = await localStorageService.getPublications();
      const filtered = all.filter((p) => p.id !== seededPubId);
      await (localStorageService as any).atomicWriteJson(
        path.join(config.DATA_DIR, 'metadata', 'publications.json'),
        filtered
      );
    } catch {}
  });

  // 1. Health endpoint
  it('GET /api/v1/health returns runtime status and uptime', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
    expect(typeof res.body.data.cronEnabled).toBe('boolean');
  });

  // 2. Sources listing
  it('GET /api/v1/sources returns all four configured regulatory sources', async () => {
    const res = await request(app).get('/api/v1/sources');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const keys = res.body.data.map((s: any) => s.sourceKey.toLowerCase());
    expect(keys).toContain('sama');
    expect(keys).toContain('cbuae');
    expect(keys).toContain('rbi');
    expect(keys).toContain('cbk');
  });

  // 3. Authentication for admin endpoints
  it('POST /api/v1/monitoring/run requires x-api-key', async () => {
    const resNoKey = await request(app).post('/api/v1/monitoring/run');
    expect(resNoKey.status).toBe(401);
    expect(resNoKey.body.success).toBe(false);

    const resWrongKey = await request(app)
      .post('/api/v1/monitoring/run')
      .set('x-api-key', 'wrong-key');
    expect(resWrongKey.status).toBe(401);
    expect(resWrongKey.body.success).toBe(false);
  });

  // 4. Unknown source handling
  it('POST /api/v1/monitoring/run/:sourceKey rejects unknown source with 404', async () => {
    const res = await request(app)
      .post('/api/v1/monitoring/run/unknown-authority')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Unknown regulatory source');
  });

  // 5. Trigger valid source
  it('POST /api/v1/monitoring/run/:sourceKey accepts valid source with 202', async () => {
    const res = await request(app)
      .post('/api/v1/monitoring/run/rbi')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('running');
    expect(res.body.data.runId).toBeDefined();
  });

  // 6. Monitoring runs history
  it('GET /api/v1/monitoring/runs returns paginated history', async () => {
    const res = await request(app).get('/api/v1/monitoring/runs?limit=10&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.runs)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  // 7. List publications with filters and search
  it('GET /api/v1/regulations supports jurisdiction filter and keyword search', async () => {
    const resAll = await request(app).get('/api/v1/regulations');
    expect(resAll.status).toBe(200);
    expect(resAll.body.success).toBe(true);
    expect(resAll.body.data.publications.length).toBeGreaterThan(0);

    // Jurisdiction filter
    const resIn = await request(app).get('/api/v1/regulations?jurisdiction=IN');
    expect(resIn.status).toBe(200);
    for (const pub of resIn.body.data.publications) {
      expect(pub.jurisdiction).toBe('IN');
    }

    // Search query
    const resSearch = await request(app).get('/api/v1/regulations?search=Monetary');
    expect(resSearch.status).toBe(200);
    expect(resSearch.body.data.publications.length).toBeGreaterThan(0);
    const foundMonetary = resSearch.body.data.publications.some((p: any) =>
      p.title.includes('Monetary') || p.id === seededPubId
    );
    expect(foundMonetary).toBe(true);
  });

  // 8. Get single publication
  it('GET /api/v1/regulations/:id returns publication details or 404', async () => {
    const resFound = await request(app).get(`/api/v1/regulations/${seededPubId}`);
    expect(resFound.status).toBe(200);
    expect(resFound.body.success).toBe(true);
    expect(resFound.body.data.id).toBe(seededPubId);

    const resMissing = await request(app).get('/api/v1/regulations/non-existent-id');
    expect(resMissing.status).toBe(404);
    expect(resMissing.body.success).toBe(false);
  });

  // 9. Get extracted text
  it('GET /api/v1/regulations/:id/text returns extracted document text', async () => {
    const res = await request(app).get(`/api/v1/regulations/${seededPubId}/text`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toContain('Extracted plain text for monetary policy');
    expect(res.body.data.wordCount).toBeGreaterThan(0);
  });

  // 10. Download original document file
  it('GET /api/v1/regulations/:id/download streams file with appropriate headers', async () => {
    const res = await request(app)
      .get(`/api/v1/regulations/${seededPubId}/download`)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
    const content = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;
    expect(content).toContain('Mock HTML Body for API Integration Testing');
  });

  // 11. Download extracted text file
  it('GET /api/v1/regulations/:id/download-text returns text as downloadable attachment', async () => {
    const res = await request(app).get(`/api/v1/regulations/${seededPubId}/download-text`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('.txt');
    expect(res.text).toContain('Extracted plain text for monetary policy');
  });

  // 12. Storage statistics
  it('GET /api/v1/storage/stats returns actual filesystem statistics', async () => {
    const res = await request(app).get('/api/v1/storage/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalStoredPublications).toBeGreaterThan(0);
    expect(res.body.data.totalDownloadedFiles).toBeGreaterThan(0);
    expect(res.body.data.totalStorageSizeBytes).toBeGreaterThan(0);
  });

  // 13. Retry endpoint requires authentication
  it('POST /api/v1/regulations/:id/retry enforces authentication', async () => {
    const res = await request(app).post(`/api/v1/regulations/${seededPubId}/retry`);
    expect(res.status).toBe(401);
  });
});
