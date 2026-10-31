import { describe, it, expect } from 'vitest';
import { normalizationService } from '../../src/regulatory/services/normalization.service';
import { RegulatoryPublication } from '../../src/regulatory/types';

describe('Metadata Normalization Service', () => {
  it('normalizes relative and absolute URLs correctly', () => {
    const base = 'https://rulebook.sama.gov.sa/en/sama-circulars';
    const relative = '/en/node/11111#section-1';
    const normalized = normalizationService.normalizeUrl(relative, base);

    expect(normalized).toBe('https://rulebook.sama.gov.sa/en/node/11111');
  });

  it('normalizes various date formats into ISO strings', () => {
    // SAMA DD/MM/YYYY format
    const ddmmyyyy = normalizationService.normalizeDate('01/10/2026');
    expect(ddmmyyyy).toBe('2026-10-01T00:00:00.000Z');

    // RFC 2822 format from RSS
    const rfcDate = normalizationService.normalizeDate('Fri, 30 Oct 2026 15:15:00 GMT');
    expect(rfcDate).toBe('2026-10-30T15:15:00.000Z');

    // Null and empty strings
    expect(normalizationService.normalizeDate(null)).toBeNull();
    expect(normalizationService.normalizeDate('')).toBeNull();
    expect(normalizationService.normalizeDate('not-a-valid-date')).toBeNull();
  });

  it('cleans whitespace and control characters from text', () => {
    const raw = '   Central   Bank \n\t  Circular No. 1   ';
    expect(normalizationService.cleanText(raw)).toBe('Central Bank Circular No. 1');
  });

  it('transforms raw RegulatoryPublication into a normalized StoredPublication skeleton', () => {
    const raw: RegulatoryPublication = {
      sourceKey: 'RBI',
      authority: 'RBI',
      jurisdiction: 'in',
      title: '  Implementation of Section 51A   ',
      sourceUrl: 'https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13749&Mode=0#anchor',
      documentUrl: 'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT303.PDF',
      publicationDate: 'Fri, 30 Oct 2026 15:15:00 GMT',
      effectiveDate: null,
      referenceNumber: '  RBI/2026-27/303  ',
      documentType: 'Notification',
      discoveredAt: '2026-10-31T00:00:00.000Z'
    };

    const normalized = normalizationService.normalizePublication(raw);

    expect(normalized.sourceKey).toBe('rbi');
    expect(normalized.jurisdiction).toBe('IN');
    expect(normalized.title).toBe('Implementation of Section 51A');
    expect(normalized.referenceNumber).toBe('RBI/2026-27/303');
    expect(normalized.publicationDate).toBe('2026-10-30T15:15:00.000Z');
    expect(normalized.documentUrl).toBe('https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT303.PDF');
    expect(normalized.status).toBe('discovered');
    expect(normalized.id.startsWith('rbi-')).toBe(true);
  });
});
