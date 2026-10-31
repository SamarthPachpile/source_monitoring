import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { monitoringService } from '../../src/regulatory/services/monitoring.service';
import { sourceRegistry } from '../../src/regulatory/registry';
import { downloadService } from '../../src/regulatory/services/download.service';
import { extractionService } from '../../src/regulatory/services/extraction.service';
import { localStorageService } from '../../src/storage/local-storage';

describe('Monitoring Service Pipeline & Fault Tolerance', () => {
  beforeAll(async () => {
    localStorageService.initDirectories();
  });

  afterAll(async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const config = (await import('../../src/config/env')).config;
      const pubFile = path.join(config.DATA_DIR, 'metadata', 'publications.json');
      if (fs.existsSync(pubFile)) {
        const pubs = JSON.parse(await fs.promises.readFile(pubFile, 'utf8'));
        const cleaned = pubs.filter(
          (p: any) =>
            p.referenceNumber !== 'CBUAE-CAP-01' &&
            p.referenceNumber !== 'RBI/2026-27/700'
        );
        await fs.promises.writeFile(pubFile, JSON.stringify(cleaned, null, 2), 'utf8');
      }
    } catch {}
  });

  it('continues processing when one source fails and records per-source results independently', async () => {
    const samaAdapter = sourceRegistry.getAdapter('sama')!;
    const cbuaeAdapter = sourceRegistry.getAdapter('cbuae')!;
    const rbiAdapter = sourceRegistry.getAdapter('rbi')!;
    const cbkAdapter = sourceRegistry.getAdapter('cbk')!;

    // 1. Mock SAMA to fail
    const samaSpy = vi.spyOn(samaAdapter, 'discover').mockRejectedValueOnce(
      new Error('SAMA connection timeout simulation')
    );

    // 2. Mock CBUAE to succeed with 1 publication
    const cbuaeSpy = vi.spyOn(cbuaeAdapter, 'discover').mockResolvedValueOnce([
      {
        sourceKey: 'cbuae',
        authority: 'CBUAE',
        jurisdiction: 'AE',
        title: 'Capital Requirements Standard',
        sourceUrl: 'https://rulebook.centralbank.ae/en/rulebook/capital',
        documentUrl: 'https://rulebook.centralbank.ae/doc.pdf',
        publicationDate: null,
        effectiveDate: null,
        referenceNumber: 'CBUAE-CAP-01',
        documentType: 'Standard',
        discoveredAt: new Date().toISOString()
      }
    ]);

    // 3. Mock RBI to succeed with 1 publication
    const rbiSpy = vi.spyOn(rbiAdapter, 'discover').mockResolvedValueOnce([
      {
        sourceKey: 'rbi',
        authority: 'RBI',
        jurisdiction: 'IN',
        title: 'Credit Information Sharing Directive',
        sourceUrl: 'https://rbi.org.in/notice/2',
        documentUrl: 'https://rbidocs.rbi.org.in/notice2.pdf',
        publicationDate: '2026-10-15T00:00:00.000Z',
        effectiveDate: null,
        referenceNumber: 'RBI/2026-27/700',
        documentType: 'Directive',
        discoveredAt: new Date().toISOString()
      }
    ]);

    // 4. Mock CBK to succeed with 0 publications
    const cbkSpy = vi.spyOn(cbkAdapter, 'discover').mockResolvedValueOnce([]);

    // 5. Mock downloadService and extractionService to avoid real network calls
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const downloadSpy = vi.spyOn(downloadService, 'downloadFile').mockImplementation(async () => {
      const f = path.join(os.tmpdir(), `test-mock-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
      await fs.promises.writeFile(f, '<html><body>Mock HTML Regulatory Content</body></html>', 'utf8');
      return {
        tempFilePath: f,
        contentHash: `hash-${Date.now()}-${Math.random()}`,
        fileSizeBytes: 45,
        mimeType: 'text/html',
        extension: 'html'
      };
    });

    const extractSpy = vi.spyOn(extractionService, 'extractFromFile').mockResolvedValue({
      text: 'Extracted regulatory text',
      wordCount: 3,
      requiresOcr: false,
      format: 'html'
    });

    // Run full monitoring cycle
    const run = await monitoringService.runMonitoringCycle({ triggeredBy: 'manual' });

    expect(run.status).toBe('completed');
    expect(run.sourcesChecked).toContain('sama');
    expect(run.sourcesChecked).toContain('cbuae');
    expect(run.sourcesChecked).toContain('rbi');
    expect(run.sourcesChecked).toContain('cbk');

    // SAMA failed, but other sources completed!
    expect(run.sourceResults['sama'].status).toBe('failed');
    expect(run.sourceResults['sama'].errors.length).toBeGreaterThan(0);
    expect(run.sourceResults['sama'].errors[0]).toContain('SAMA connection timeout simulation');

    expect(run.sourceResults['cbuae'].status).toBe('success');
    expect(run.sourceResults['cbuae'].discovered).toBe(1);

    expect(run.sourceResults['rbi'].status).toBe('success');
    expect(run.sourceResults['rbi'].discovered).toBe(1);

    expect(run.sourceResults['cbk'].status).toBe('success');
    expect(run.sourceResults['cbk'].discovered).toBe(0);

    // Total discovered
    expect(run.discoveredCount).toBe(2);

    samaSpy.mockRestore();
    cbuaeSpy.mockRestore();
    rbiSpy.mockRestore();
    cbkSpy.mockRestore();
    downloadSpy.mockRestore();
    extractSpy.mockRestore();
  });

  it('prevents overlapping monitoring runs and enforces mutex lock', async () => {
    // Start first run but pause it
    const samaAdapter = sourceRegistry.getAdapter('sama')!;
    let resolveSama: any;
    const pendingPromise = new Promise((resolve) => {
      resolveSama = resolve;
    });

    const samaSpy = vi.spyOn(samaAdapter, 'discover').mockImplementationOnce(() => pendingPromise as any);

    // Start run 1 (don't await)
    const run1Promise = monitoringService.runMonitoringCycle({
      triggeredBy: 'manual',
      targetSourceKey: 'sama'
    });

    // Attempt run 2 immediately - should reject with 409 conflict
    await expect(
      monitoringService.runMonitoringCycle({
        triggeredBy: 'manual',
        targetSourceKey: 'sama'
      })
    ).rejects.toThrow(/already in progress/);

    // Resolve run 1
    resolveSama([]);
    await run1Promise;

    samaSpy.mockRestore();
  });
});
