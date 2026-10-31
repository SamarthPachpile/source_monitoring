import axios from 'axios';
import * as cheerio from 'cheerio';
import { RegulatoryPublication, RegulatorySourceAdapter } from '../types';
import { logger } from '../../utils/logger';
import { SourceExtractionError } from '../../utils/errors';
import { config } from '../../config/env';

export class CbuaeAdapter implements RegulatorySourceAdapter {
  public readonly sourceKey = 'cbuae';
  public readonly authority = 'CBUAE';
  public readonly jurisdiction = 'AE';
  public readonly region = 'UAE';
  public readonly startingUrl = 'https://rulebook.centralbank.ae/en';

  private readonly bankingUrl = 'https://rulebook.centralbank.ae/en/rulebook/banking';
  private readonly baseUrl = 'https://rulebook.centralbank.ae';

  public async discover(): Promise<RegulatoryPublication[]> {
    logger.info({ source: this.sourceKey, url: this.bankingUrl }, 'Discovering CBUAE publications');

    let html: string;
    try {
      const response = await axios.get(this.bankingUrl, {
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
    const seenUrls = new Set<string>();
    const maxItems = config.REGULATORY_MAX_ITEMS_PER_SOURCE;

    $('a').each((_, el) => {
      if (publications.length >= maxItems) return;

      const href = $(el).attr('href');
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      if (
        href &&
        href.startsWith('/en/rulebook/') &&
        text.length > 5 &&
        !['banking', 'insurance', 'other-regulated-entities', 'all-licensed-financial-institutions'].includes(
          href.split('/').pop() || ''
        )
      ) {
        const fullSourceUrl = `${this.baseUrl}${href}`;
        if (!seenUrls.has(fullSourceUrl)) {
          seenUrls.add(fullSourceUrl);

          const isStandard = text.toLowerCase().includes('standard');
          const isGuidance = text.toLowerCase().includes('guidance');
          const docType = isStandard ? 'Standard' : isGuidance ? 'Guidance' : 'Regulation';

          // Slugs can serve as reliable reference/identifier
          const slug = href.replace('/en/rulebook/', '');

          publications.push({
            sourceKey: this.sourceKey,
            authority: this.authority,
            jurisdiction: this.jurisdiction,
            title: text,
            sourceUrl: fullSourceUrl,
            documentUrl: fullSourceUrl,
            publicationDate: null,
            effectiveDate: null,
            referenceNumber: `CBUAE-${slug.toUpperCase()}`,
            documentType: docType,
            discoveredAt: new Date().toISOString()
          });
        }
      }
    });

    if (publications.length === 0) {
      logger.warn({ source: this.sourceKey }, 'No regulations extracted from CBUAE rulebook');
    } else {
      logger.info({ source: this.sourceKey, count: publications.length }, 'Discovered CBUAE publications');
    }

    return publications;
  }
}

export const cbuaeAdapter = new CbuaeAdapter();
