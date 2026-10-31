import axios from 'axios';
import * as cheerio from 'cheerio';
import { RegulatoryPublication, RegulatorySourceAdapter } from '../types';
import { logger } from '../../utils/logger';
import { SourceExtractionError } from '../../utils/errors';
import { config } from '../../config/env';

export class SamaAdapter implements RegulatorySourceAdapter {
  public readonly sourceKey = 'sama';
  public readonly authority = 'SAMA';
  public readonly jurisdiction = 'SA';
  public readonly region = 'KSA';
  public readonly startingUrl = 'https://rulebook.sama.gov.sa/en/sama-circulars';

  private readonly baseUrl = 'https://rulebook.sama.gov.sa';

  public async discover(): Promise<RegulatoryPublication[]> {
    logger.info({ source: this.sourceKey, url: this.startingUrl }, 'Discovering SAMA publications');

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
    const maxItems = config.REGULATORY_MAX_ITEMS_PER_SOURCE;

    // Parse circulars table rows
    $('table tbody tr').each((_, row) => {
      if (publications.length >= maxItems) return;

      const tds = $(row).find('td');
      if (tds.length >= 4) {
        const col0 = $(tds[0]);
        const col1 = $(tds[1]);
        const col2 = $(tds[2]);

        const refNo = col0.text().trim();
        const title = col1.text().trim();
        const dateStr = col2.text().trim();

        // Check if there is a link
        const linkElem = col1.find('a').first().length ? col1.find('a').first() : col0.find('a').first();
        const href = linkElem.attr('href');

        if (title && refNo && /^\d+$/.test(refNo)) {
          const sourceUrl = href
            ? (href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`)
            : this.startingUrl;

          // Fetch the official HTML publication page directly
          const documentUrl = sourceUrl;

          publications.push({
            sourceKey: this.sourceKey,
            authority: this.authority,
            jurisdiction: this.jurisdiction,
            title,
            sourceUrl,
            documentUrl,
            publicationDate: dateStr || null,
            effectiveDate: null,
            referenceNumber: refNo,
            documentType: 'Circular',
            discoveredAt: new Date().toISOString()
          });
        }
      }
    });

    if (publications.length === 0) {
      logger.warn({ source: this.sourceKey }, 'No circulars extracted from SAMA table');
    } else {
      logger.info({ source: this.sourceKey, count: publications.length }, 'Discovered SAMA publications');
    }

    return publications;
  }
}

export const samaAdapter = new SamaAdapter();
