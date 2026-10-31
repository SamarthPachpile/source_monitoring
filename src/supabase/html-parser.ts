import * as cheerio from 'cheerio';
import { sha256 } from '../utils/hashing';

export interface RegulatoryMetadataInput {
  id: string;
  title: string;
  authority: string;
  jurisdiction: string;
  region?: string | null;
  sourceUrl?: string | null;
  documentUrl?: string | null;
  publicationDate?: string | null;
  effectiveDate?: string | null;
  referenceNumber?: string | null;
  documentType?: string | null;
  contentHash?: string | null;
}

export interface RegDocumentRow {
  id: string;
  title: string;
  authority: string;
  jurisdiction: string;
  region: string | null;
  source_url: string | null;
  document_url: string | null;
  publication_date: string | null;
  effective_date: string | null;
  reference_number: string | null;
  document_type: string | null;
  content_hash: string | null;
  raw_html: string | null;
}

export interface RegSectionRow {
  id: string;
  doc_id: string;
  section_number: string | null;
  heading: string;
  order_index: number;
  ref_path: string;
}

export interface RegParagraphRow {
  id: string;
  doc_id: string;
  section_id: string | null;
  ref_path: string;
  text: string;
  clause_number: string | null;
  order_index: number;
}

export interface ParsedHierarchy {
  document: RegDocumentRow;
  sections: RegSectionRow[];
  paragraphs: RegParagraphRow[];
}

export class RegulatoryHtmlParser {
  /**
   * Parse HTML and map to hierarchical tables:
   * reg_documents -> reg_sections (cp1) -> reg_paragraphs (cp2 with ref_path)
   */
  public parse(htmlContent: string, meta: RegulatoryMetadataInput): ParsedHierarchy {
    const $ = cheerio.load(htmlContent);

    // 1. Strip non-content and noisy elements
    $('script, style, nav, header, footer, noscript, iframe, svg, input, select, textarea, button').remove();

    // 2. Prepare Document Row
    const hash = meta.contentHash || sha256(htmlContent);
    const document: RegDocumentRow = {
      id: meta.id,
      title: meta.title,
      authority: meta.authority,
      jurisdiction: meta.jurisdiction,
      region: meta.region || this.inferRegion(meta.jurisdiction),
      source_url: meta.sourceUrl || null,
      document_url: meta.documentUrl || null,
      publication_date: meta.publicationDate || null,
      effective_date: meta.effectiveDate || null,
      reference_number: meta.referenceNumber || null,
      document_type: meta.documentType || 'Circular',
      content_hash: hash,
      raw_html: htmlContent
    };

    const sections: RegSectionRow[] = [];
    const paragraphs: RegParagraphRow[] = [];

    let currentSection: RegSectionRow | null = null;
    let sectionIdx = 0;
    let paraIdx = 0;

    // Traverse structural tags: h1-h6 for sections, p/li/tr for clauses
    $('h1, h2, h3, h4, h5, h6, p, li, blockquote, tr').each((_, el) => {
      const tagName = el.tagName.toLowerCase();
      const rawText = $(el).text();
      const cleanText = rawText.replace(/\s+/g, ' ').trim();

      // Skip empty or tiny noise
      if (cleanText.length < 4) return;

      const isHeading = tagName.startsWith('h');

      if (isHeading) {
        sectionIdx++;
        const secNumMatch = cleanText.match(/^(?:section|chapter|part|article)?\s*([0-9A-Za-z.-]+)/i);
        const sectionNumber = secNumMatch ? secNumMatch[1].replace(/[.:]$/, '') : `${sectionIdx}`;
        const refPath = `sec-${sectionNumber}`;

        currentSection = {
          id: `${meta.id}-sec-${sectionIdx}`,
          doc_id: meta.id,
          section_number: sectionNumber,
          heading: cleanText,
          order_index: sectionIdx,
          ref_path: refPath
        };
        sections.push(currentSection);
      } else {
        paraIdx++;
        // Detect clause numbers like "4.1", "4.", "(a)", "1."
        const clauseMatch = cleanText.match(/^(?:(\d+(?:\.\d+)*|\([a-z0-9]+\))\s*)/i);
        const clauseNumber = clauseMatch ? clauseMatch[1].replace(/[.:]$/, '') : null;

        // Build deterministic ref_path (e.g. "sec-4/para-4.1" or "para-1")
        let refPath: string;
        if (currentSection) {
          refPath = clauseNumber
            ? `${currentSection.ref_path}/para-${clauseNumber}`
            : `${currentSection.ref_path}/para-${paraIdx}`;
        } else {
          refPath = clauseNumber ? `para-${clauseNumber}` : `para-${paraIdx}`;
        }

        paragraphs.push({
          id: `${meta.id}-p-${paraIdx}`,
          doc_id: meta.id,
          section_id: currentSection ? currentSection.id : null,
          ref_path: refPath,
          text: cleanText,
          clause_number: clauseNumber,
          order_index: paraIdx
        });
      }
    });

    // Fallback: If no headings were present, create a default top section so hierarchy is preserved
    if (sections.length === 0 && paragraphs.length > 0) {
      const defaultSec: RegSectionRow = {
        id: `${meta.id}-sec-1`,
        doc_id: meta.id,
        section_number: '1',
        heading: meta.title || 'General Provisions',
        order_index: 1,
        ref_path: 'sec-1'
      };
      sections.push(defaultSec);
      for (const p of paragraphs) {
        p.section_id = defaultSec.id;
        p.ref_path = `sec-1/${p.ref_path}`;
      }
    }

    return { document, sections, paragraphs };
  }

  private inferRegion(jurisdiction: string): string {
    switch (jurisdiction.toUpperCase()) {
      case 'SA':
        return 'KSA';
      case 'AE':
        return 'UAE';
      case 'IN':
        return 'INDIA';
      case 'KE':
        return 'AFRICA';
      default:
        return jurisdiction.toUpperCase();
    }
  }
}

export const regulatoryHtmlParser = new RegulatoryHtmlParser();
