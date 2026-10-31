import { describe, it, expect } from 'vitest';
import { extractionService } from '../../src/regulatory/services/extraction.service';

describe('Document Text Extraction Service', () => {
  it('extracts clean body text from HTML while removing scripts, styles, and navigation', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Circular</title>
          <style>.hide { display: none; }</style>
          <script>console.log("tracker");</script>
        </head>
        <body>
          <header><nav><a href="/">Home</a></nav></header>
          <main>
            <article>
              <h1>Banking Regulation No. 12</h1>
              <p>All financial institutions must comply with new capital requirements starting next quarter.</p>
            </article>
          </main>
          <footer>Copyright 2026 Central Bank</footer>
        </body>
      </html>
    `;

    const result = extractionService.extractHtml(rawHtml);
    expect(result.format).toBe('html');
    expect(result.text).toContain('Banking Regulation No. 12');
    expect(result.text).toContain('All financial institutions must comply');
    // Ensure scripts, styles, header, footer are excluded
    expect(result.text).not.toContain('console.log');
    expect(result.text).not.toContain('Copyright 2026');
    expect(result.text).not.toContain('Home');
    expect(result.wordCount).toBeGreaterThan(5);
  });

  it('preserves official circular forms while stripping form controls in ASP.NET HTML', () => {
    const aspxHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <form id="form1">
            <input type="hidden" name="__VIEWSTATE" value="xyz" />
            <table class="tablebg">
              <tr>
                <td>
                  <p>Reserve Bank of India Circular on Master Directions for NBFCs.</p>
                  <p>Effective from April 1, 2026.</p>
                </td>
              </tr>
            </table>
            <button type="submit">Submit</button>
          </form>
        </body>
      </html>
    `;

    const result = extractionService.extractHtml(aspxHtml);
    expect(result.format).toBe('html');
    expect(result.text).toContain('Reserve Bank of India Circular');
    expect(result.text).toContain('Effective from April 1, 2026');
    expect(result.text).not.toContain('xyz');
    expect(result.text).not.toContain('Submit');
  });

  it('extracts plain text safely preserving content', async () => {
    const plainText = 'Directives on AML compliance for commercial banks.';
    const buffer = Buffer.from(plainText, 'utf8');
    const result = await extractionService.extractFromBuffer(buffer, 'directive.txt');

    expect(result.format).toBe('txt');
    expect(result.text).toBe(plainText);
    expect(result.wordCount).toBe(7);
  });

  it('extracts standardized generalized HTML circular correctly', async () => {
    const circularHtml = `<!DOCTYPE html><html><body><h1>RBI Circular</h1><p>Important update on banking norms.</p></body></html>`;
    const buffer = Buffer.from(circularHtml, 'utf8');
    const result = await extractionService.extractFromBuffer(buffer, 'circular.html');

    expect(result.format).toBe('html');
    expect(result.text).toContain('RBI Circular');
    expect(result.text).toContain('Important update on banking norms.');
  });
});
