import axios from 'axios';
import * as cheerio from 'cheerio';
import { RegulatoryPublication, RegulatorySourceAdapter } from '../types';
import { logger } from '../../utils/logger';
import { SourceExtractionError } from '../../utils/errors';
import { config } from '../../config/env';

export class CbkAdapter implements RegulatorySourceAdapter {
  public readonly sourceKey = 'cbk';
  public readonly authority = 'CBK';
  public readonly jurisdiction = 'KE';
  public readonly region = 'AFRICA';
  public readonly startingUrl =
    'https://www.centralbank.go.ke/policy-procedures/legislation-and-guidelines/circulars/';

  private readonly baseUrl = 'https://www.centralbank.go.ke';

  public async discover(): Promise<RegulatoryPublication[]> {
    logger.info({ source: this.sourceKey, url: this.startingUrl }, 'Discovering CBK circulars');

    let html: string;
    try {
      const response = await axios.get(this.startingUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 20000
      });
      html = response.data;
    } catch (err: any) {
      throw new SourceExtractionError(this.sourceKey, `HTTP request failed: ${err.message}`);
    }

    const $ = cheerio.load(html);
    const publications: RegulatoryPublication[] = [];
    const seenLinks = new Set<string>();
    const maxItems = config.REGULATORY_MAX_ITEMS_PER_SOURCE;

    $('table tr').each((_, row) => {
      if (publications.length >= maxItems) return;

      const links = $(row).find('a');
      links.each((__, a) => {
        if (publications.length >= maxItems) return;

        const href = $(a).attr('href');
        const linkText = $(a).text().trim();

        if (href && (href.toLowerCase().endsWith('.pdf') || href.includes('uploads/banking_circulars'))) {
          const docUrl = href.startsWith('http')
            ? href
            : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

          if (!seenLinks.has(docUrl)) {
            seenLinks.add(docUrl);

            const title = linkText || $(row).find('td').last().text().trim() || 'Central Bank of Kenya Circular';

            // Extract circular number if present: e.g. "Banking Circular No. 1 of 2026"
            const refMatch = title.match(/(?:Banking\s+)?Circular\s+No\.?\s*\d+\s+of\s+\d{4}/i);
            const refNo = refMatch ? refMatch[0] : null;

            // Extract year if present
            const yearMatch = title.match(/\b(20\d{2})\b/);
            const pubDate = yearMatch ? `${yearMatch[1]}-01-01T00:00:00.000Z` : null;

            publications.push({
              sourceKey: this.sourceKey,
              authority: this.authority,
              jurisdiction: this.jurisdiction,
              title,
              sourceUrl: this.startingUrl,
              documentUrl: docUrl,
              publicationDate: pubDate,
              effectiveDate: null,
              referenceNumber: refNo,
              documentType: 'Circular',
              discoveredAt: new Date().toISOString()
            });
          }
        }
      });
    });

    if (publications.length === 0) {
      logger.warn({ source: this.sourceKey }, 'No circulars extracted from CBK circulars page');
    } else {
      logger.info({ source: this.sourceKey, count: publications.length }, 'Discovered CBK publications');
    }

    return publications;
  }
}

export const cbkAdapter = new CbkAdapter();
