import fs from 'fs';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import * as pdfParseModule from 'pdf-parse';
import { logger } from '../../utils/logger';

export interface ExtractionResult {
  text: string;
  wordCount: number;
  requiresOcr: boolean;
  format: 'pdf' | 'docx' | 'html' | 'txt' | 'unknown';
}

export class ExtractionService {
  /**
   * Automatically detect format and extract text from a file on disk
   */
  public async extractFromFile(filePath: string, mimeType?: string): Promise<ExtractionResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist for extraction: ${filePath}`);
    }

    const buffer = await fs.promises.readFile(filePath);
    return this.extractFromBuffer(buffer, filePath, mimeType);
  }

  /**
   * Extract text from buffer with format detection
   */
  public async extractFromBuffer(
    buffer: Buffer,
    filePathHint?: string,
    mimeType?: string
  ): Promise<ExtractionResult> {
    const detectedFormat = this.detectFormat(buffer, filePathHint, mimeType);

    switch (detectedFormat) {
      case 'pdf':
        return this.extractPdf(buffer);
      case 'docx':
        return this.extractDocx(buffer);
      case 'html':
        return this.extractHtml(buffer.toString('utf8'));
      case 'txt':
        return this.extractPlainText(buffer.toString('utf8'));
      default:
        // Try fallback plain text if UTF-8 compatible
        return this.extractPlainText(buffer.toString('utf8'));
    }
  }

  private detectFormat(
    buffer: Buffer,
    filePathHint?: string,
    mimeType?: string
  ): 'pdf' | 'docx' | 'html' | 'txt' | 'unknown' {
    // Check magic bytes
    if (buffer.length >= 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
      return 'pdf';
    }
    // DOCX is a zip file starting with PK\x03\x04
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04 &&
      filePathHint?.endsWith('.docx')
    ) {
      return 'docx';
    }

    if (mimeType?.includes('pdf') || filePathHint?.toLowerCase().endsWith('.pdf')) {
      return 'pdf';
    }
    if (mimeType?.includes('word') || filePathHint?.toLowerCase().endsWith('.docx')) {
      return 'docx';
    }
    if (
      mimeType?.includes('html') ||
      filePathHint?.toLowerCase().endsWith('.html') ||
      filePathHint?.toLowerCase().endsWith('.htm')
    ) {
      return 'html';
    }

    // Inspect initial string content for HTML tags
    const sample = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).toLowerCase();
    if (sample.includes('<html') || sample.includes('<!doctype html') || sample.includes('<body')) {
      return 'html';
    }

    if (filePathHint?.toLowerCase().endsWith('.txt') || mimeType?.includes('plain')) {
      return 'txt';
    }

    return 'unknown';
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const pdfLib = (pdfParseModule as any).default || pdfParseModule;
      let text = '';
      if (typeof pdfLib.PDFParse === 'function') {
        const parser = new pdfLib.PDFParse({ data: buffer });
        await parser.load();
        const res = await parser.getText();
        text = typeof res === 'string' ? res : res?.text || '';
      } else if (typeof pdfLib === 'function') {
        const data = await pdfLib(buffer);
        text = data.text || '';
      } else {
        throw new Error('Unsupported pdf-parse interface');
      }

      text = text.trim();
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      
      // If a PDF has multiple pages or bytes but virtually no text, it is likely scanned
      const requiresOcr = words < 10 && buffer.length > 5000;

      return {
        text,
        wordCount: words,
        requiresOcr,
        format: 'pdf'
      };
    } catch (err: any) {
      logger.error({ error: err.message }, 'PDF parsing failed');
      throw new Error(`PDF text extraction error: ${err.message}`);
    }
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value || '').trim();
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

      return {
        text,
        wordCount: words,
        requiresOcr: false,
        format: 'docx'
      };
    } catch (err: any) {
      logger.error({ error: err.message }, 'DOCX parsing failed');
      throw new Error(`DOCX text extraction error: ${err.message}`);
    }
  }

  public extractHtml(html: string): ExtractionResult {
    try {
      const $ = cheerio.load(html);

      // Remove irrelevant tags (do not remove form as ASP.NET wraps the entire body in form)
      $('script, style, noscript, nav, header, footer, svg, iframe, input, select, textarea, button').remove();

      // Look for main body elements first
      let content = $(
        'article, main, .publication-content, .field--name-body, .node__content, .circular-details, #content, .tablebg'
      ).text();

      if (!content || content.trim().length < 50) {
        content = $('body').text();
      }

      // Normalize whitespace
      const normalized = (content || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();

      const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;

      return {
        text: normalized,
        wordCount: words,
        requiresOcr: false,
        format: 'html'
      };
    } catch (err: any) {
      logger.error({ error: err.message }, 'HTML parsing failed');
      throw new Error(`HTML text extraction error: ${err.message}`);
    }
  }

  private extractPlainText(rawText: string): ExtractionResult {
    const normalized = (rawText || '').trim();
    const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
    return {
      text: normalized,
      wordCount: words,
      requiresOcr: false,
      format: 'txt'
    };
  }
}

export const extractionService = new ExtractionService();
