import Parser from 'rss-parser';
import { RegulatoryPublication, RegulatorySourceAdapter } from '../types';
import { logger } from '../../utils/logger';
import { SourceExtractionError } from '../../utils/errors';
import { config } from '../../config/env';

export class RbiAdapter implements RegulatorySourceAdapter {
  public readonly sourceKey = 'rbi';
  public readonly authority = 'RBI';
  public readonly jurisdiction = 'IN';
  public readonly region = 'INDIA';
  public readonly startingUrl = 'https://www.rbi.org.in/notifications_rss.xml';

  private readonly parser = new Parser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  public async discover(): Promise<RegulatoryPublication[]> {
    logger.info({ source: this.sourceKey, url: this.startingUrl }, 'Discovering RBI publications via RSS');

    let feed;
    try {
      feed = await this.parser.parseURL(this.startingUrl);
    } catch (err: any) {
      throw new SourceExtractionError(this.sourceKey, `RSS feed request failed: ${err.message}`);
    }

    const publications: RegulatoryPublication[] = [];
    const maxItems = config.REGULATORY_MAX_ITEMS_PER_SOURCE;

    for (const item of feed.items || []) {
      if (publications.length >= maxItems) break;
      if (!item.title || !item.link) continue;

      const title = item.title.trim();
      const sourceUrl = item.link.trim();
      const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : null;

      // Extract reference number from contentSnippet or content
      let refNo: string | null = null;
      const snippet = item.contentSnippet || item.content || '';
      const rbiMatch = snippet.match(/RBI\/\d{4}-\d{2,4}\/\d+/);
      const docRefMatch = snippet.match(/[A-Z][A-Za-z0-9_.-]+\/[0-9.]+\/\d{4}-\d{2,4}/);

      if (rbiMatch) {
        refNo = rbiMatch[0];
      } else if (docRefMatch) {
        refNo = docRefMatch[0];
      }

      publications.push({
        sourceKey: this.sourceKey,
        authority: this.authority,
        jurisdiction: this.jurisdiction,
        title,
        sourceUrl,
        documentUrl: sourceUrl,
        publicationDate: pubDate,
        effectiveDate: null,
        referenceNumber: refNo,
        documentType: 'Notification',
        discoveredAt: new Date().toISOString()
      });
    }

    if (publications.length === 0) {
      logger.warn({ source: this.sourceKey }, 'No items parsed from RBI RSS feed');
    } else {
      logger.info({ source: this.sourceKey, count: publications.length }, 'Discovered RBI publications');
    }

    return publications;
  }
}

export const rbiAdapter = new RbiAdapter();
