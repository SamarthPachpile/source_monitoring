import { RegulatoryPublication, StoredPublication } from '../types';
import { generateDocumentId } from '../../utils/hashing';

export class NormalizationService {
  /**
   * Resolve and normalize URLs relative to a base URL
   */
  public normalizeUrl(url: string, baseUrl?: string): string {
    let raw = url.trim();
    if (baseUrl && !raw.startsWith('http://') && !raw.startsWith('https://')) {
      try {
        const resolved = new URL(raw, baseUrl);
        resolved.hash = '';
        return resolved.toString();
      } catch {
        return raw;
      }
    }
    try {
      const parsed = new URL(raw);
      // Remove hash anchors
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  /**
   * Normalize an extracted date string into ISO-8601 string or null
   */
  public normalizeDate(dateStr: string | null | undefined): string | null {
    if (!dateStr || !dateStr.trim()) {
      return null;
    }
    const clean = dateStr.trim();

    // Check DD/MM/YYYY or DD-MM-YYYY (e.g. SAMA dates like 01/10/2026)
    const ddmmyyyy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
    const match = clean.match(ddmmyyyy);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    // Standard JavaScript Date parsing (handles RFC 2822 from RSS, ISO dates, etc.)
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return null;
  }

  /**
   * Clean text string (removes excess whitespaces, newlines)
   */
  public cleanText(text: string | null | undefined): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Normalize a publication record and create initial StoredPublication skeleton
   */
  public normalizePublication(pub: RegulatoryPublication): StoredPublication {
    const cleanTitle = this.cleanText(pub.title);
    const normalizedSourceUrl = this.normalizeUrl(pub.sourceUrl);
    const normalizedDocUrl = this.normalizeUrl(pub.documentUrl, pub.sourceUrl);
    const normalizedPubDate = this.normalizeDate(pub.publicationDate);
    const normalizedEffDate = this.normalizeDate(pub.effectiveDate);
    const cleanRef = pub.referenceNumber ? this.cleanText(pub.referenceNumber) : null;
    const cleanDocType = pub.documentType ? this.cleanText(pub.documentType) : null;

    // Deterministic ID generation based on stable signal: refNumber or docUrl or sourceUrl
    const seed = cleanRef || normalizedDocUrl || normalizedSourceUrl;
    const id = generateDocumentId(pub.sourceKey, seed);

    return {
      id,
      sourceKey: pub.sourceKey.toLowerCase(),
      authority: pub.authority,
      jurisdiction: pub.jurisdiction.toUpperCase(),
      title: cleanTitle,
      sourceUrl: normalizedSourceUrl,
      documentUrl: normalizedDocUrl,
      publicationDate: normalizedPubDate,
      effectiveDate: normalizedEffDate,
      referenceNumber: cleanRef,
      documentType: cleanDocType,
      filePath: null,
      extractedTextPath: null,
      contentHash: null,
      mimeType: null,
      fileSizeBytes: 0,
      status: 'discovered',
      currentVersion: 1,
      versions: [],
      firstDiscoveredAt: pub.discoveredAt || new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastDownloadedAt: null
    };
  }
}

export const normalizationService = new NormalizationService();
