import { describe, it, expect } from 'vitest';
import { regulatoryHtmlParser } from '../../src/supabase/html-parser';
import { ollamaContextService } from '../../src/ai/ollama-context';

describe('Supabase Regulatory HTML Parser & Ollama Context', () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>RBI Master Direction</title>
        <style>nav { display: none; }</style>
        <script>track();</script>
      </head>
      <body>
        <header><nav><a href="/home">Home</a></nav></header>
        <main>
          <h1>RBI Circular No. 2025-12/34</h1>
          <p>This master direction applies to all commercial banking entities in India.</p>

          <h2>4. Use of AI in Credit Decisioning</h2>
          <p>Banks may use AI tools for credit assessment, subject to stricter risk management framework, including model explainability and audit trails.</p>
          <p>4.1. Periodic independent audits must be conducted by certified reviewers.</p>

          <h2>6. Disclosure Requirements</h2>
          <p>Enhanced disclosure requirements apply, including details of AI model usage and key risk indicators.</p>
        </main>
        <footer>Official Central Bank Footer</footer>
      </body>
    </html>
  `;

  it('strips scripts, styles, navigation and extracts structural hierarchy for Supabase', () => {
    const meta = {
      id: 'rbi-2025-12-34',
      title: 'RBI Circular No. 2025-12/34',
      authority: 'RBI',
      jurisdiction: 'IN',
      sourceUrl: 'https://rbi.org.in/circular/34',
      documentUrl: 'https://rbi.org.in/circular/34.html',
      publicationDate: '2025-06-20T00:00:00.000Z',
      referenceNumber: 'RBI/2025-12/34'
    };

    const parsed = regulatoryHtmlParser.parse(sampleHtml, meta);

    // 1. Verify Document Row
    expect(parsed.document.id).toBe('rbi-2025-12-34');
    expect(parsed.document.authority).toBe('RBI');
    expect(parsed.document.jurisdiction).toBe('IN');
    expect(parsed.document.region).toBe('INDIA');
    expect(parsed.document.title).toBe('RBI Circular No. 2025-12/34');

    // 2. Verify Sections (cp1)
    expect(parsed.sections.length).toBe(3);
    expect(parsed.sections[1].heading).toContain('4. Use of AI in Credit Decisioning');
    expect(parsed.sections[1].ref_path).toBe('sec-4');
    expect(parsed.sections[2].heading).toContain('6. Disclosure Requirements');
    expect(parsed.sections[2].ref_path).toBe('sec-6');

    // 3. Verify Paragraphs (cp2 with ref_path)
    expect(parsed.paragraphs.length).toBe(4);
    
    // Check specific AI paragraph
    const aiPara = parsed.paragraphs.find((p) => p.text.includes('Banks may use AI tools for credit assessment'));
    expect(aiPara).toBeDefined();
    expect(aiPara?.ref_path).toBe('sec-4/para-2');
    expect(aiPara?.text).toContain('model explainability and audit trails');

    // Check clause 4.1
    const clause41 = parsed.paragraphs.find((p) => p.text.includes('Periodic independent audits'));
    expect(clause41).toBeDefined();
    expect(clause41?.clause_number).toBe('4.1');
    expect(clause41?.ref_path).toBe('sec-4/para-4.1');

    // Ensure scripts, styles, header, footer are excluded
    for (const p of parsed.paragraphs) {
      expect(p.text).not.toContain('track()');
      expect(p.text).not.toContain('Home');
      expect(p.text).not.toContain('Official Central Bank Footer');
    }
  });

  it('deterministic span verifier confirms verbatim matches and rejects hallucinations', () => {
    const sourceText = 'Banks may use AI tools for credit assessment, subject to stricter risk management framework, including model explainability and audit trails.';

    // Verbatim substrings should pass
    expect(
      ollamaContextService.verifySpan(sourceText, 'model explainability and audit trails')
    ).toBe(true);

    expect(
      ollamaContextService.verifySpan(sourceText, 'stricter risk management framework')
    ).toBe(true);

    // Hallucinated or altered text should fail
    expect(
      ollamaContextService.verifySpan(sourceText, 'mandatory blockchain verification')
    ).toBe(false);

    expect(
      ollamaContextService.verifySpan(sourceText, 'banks cannot use AI tools at all')
    ).toBe(false);
  });
});
