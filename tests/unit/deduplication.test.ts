import { describe, it, expect } from 'vitest';
import { deduplicationService } from '../../src/regulatory/services/deduplication.service';
import { StoredPublication } from '../../src/regulatory/types';

describe('Deduplication & Change Detection Service', () => {
  const existingPub: StoredPublication = {
    id: 'rbi-123456789abc',
    sourceKey: 'rbi',
    authority: 'RBI',
    jurisdiction: 'IN',
    title: 'Guideline on Liquidity Risk',
    sourceUrl: 'https://rbi.org.in/notice/1',
    documentUrl: 'https://rbidocs.rbi.org.in/doc1.pdf',
    publicationDate: '2026-01-01T00:00:00.000Z',
    effectiveDate: null,
    referenceNumber: 'RBI/2026-27/100',
    documentType: 'Circular',
    filePath: 'data/regulations/IN/rbi-123456789abc/original.html',
    extractedTextPath: 'data/regulations/IN/rbi-123456789abc/extracted.txt',
    contentHash: 'hash-version-1',
    mimeType: 'text/html',
    fileSizeBytes: 1024,
    status: 'downloaded',
    currentVersion: 1,
    versions: [],
    firstDiscoveredAt: '2026-01-01T00:00:00.000Z',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    lastDownloadedAt: '2026-01-01T00:00:00.000Z'
  };

  it('detects duplicate via exact ID match', () => {
    const candidate = { ...existingPub, title: 'Updated Title Name' };
    const check = deduplicationService.check(candidate, [existingPub]);

    expect(check.status).toBe('EXISTS');
    expect(check.existingPublication?.id).toBe(existingPub.id);
  });

  it('detects duplicate via regulatory reference number within authority', () => {
    const candidate: StoredPublication = {
      ...existingPub,
      id: 'rbi-different-hash',
      title: 'Different Title but Same Ref',
      referenceNumber: 'RBI/2026-27/100'
    };
    const check = deduplicationService.check(candidate, [existingPub]);

    expect(check.status).toBe('EXISTS');
    expect(check.existingPublication?.id).toBe(existingPub.id);
  });

  it('detects duplicate via normalized document URL', () => {
    const candidate: StoredPublication = {
      ...existingPub,
      id: 'rbi-another-hash',
      referenceNumber: null,
      documentUrl: 'https://rbidocs.rbi.org.in/doc1.pdf'
    };
    const check = deduplicationService.check(candidate, [existingPub]);

    expect(check.status).toBe('EXISTS');
    expect(check.existingPublication?.id).toBe(existingPub.id);
  });

  it('treats publication as NEW when no signals match', () => {
    const candidate: StoredPublication = {
      ...existingPub,
      id: 'rbi-brand-new-doc',
      referenceNumber: 'RBI/2026-27/999',
      documentUrl: 'https://rbidocs.rbi.org.in/new-unique-doc.pdf'
    };
    const check = deduplicationService.check(candidate, [existingPub]);

    expect(check.status).toBe('NEW');
    expect(check.existingPublication).toBeNull();
  });

  it('does NOT merge documents solely because they share similar titles', () => {
    const candidate: StoredPublication = {
      ...existingPub,
      id: 'rbi-completely-new',
      title: 'Guideline on Liquidity Risk', // Same title!
      referenceNumber: 'RBI/2026-27/200', // Different ref
      documentUrl: 'https://rbidocs.rbi.org.in/another-guideline.pdf' // Different URL
    };
    const check = deduplicationService.check(candidate, [existingPub]);

    expect(check.status).toBe('NEW');
  });

  it('accurately identifies content modification via contentHash', () => {
    expect(deduplicationService.isContentModified('hash1', 'hash1')).toBe(false);
    expect(deduplicationService.isContentModified('hash1', 'hash2')).toBe(true);
    expect(deduplicationService.isContentModified(null, 'hash1')).toBe(true);
  });
});
