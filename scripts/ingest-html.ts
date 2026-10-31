import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { regulatoryHtmlParser, RegulatoryMetadataInput } from '../src/supabase/html-parser';
import { supabaseService } from '../src/supabase/supabase.service';
import { isSupabaseConfigured } from '../src/supabase/client';
import { localStorageService } from '../src/storage/local-storage';

async function ingestSingleHtml(inputPathOrUrl: string, explicitMeta?: Partial<RegulatoryMetadataInput>) {
  let htmlContent = '';
  let filename = path.basename(inputPathOrUrl);

  if (inputPathOrUrl.startsWith('http://') || inputPathOrUrl.startsWith('https://')) {
    console.log(`Fetching remote HTML from ${inputPathOrUrl}...`);
    const resp = await axios.get(inputPathOrUrl, { timeout: 15000 });
    htmlContent = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  } else {
    const resolvedPath = path.resolve(inputPathOrUrl);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    htmlContent = await fs.promises.readFile(resolvedPath, 'utf8');
  }

  const docId = explicitMeta?.id || `doc-${Date.now()}`;
  const metadata: RegulatoryMetadataInput = {
    id: docId,
    title: explicitMeta?.title || filename.replace(/\.html?$/i, ''),
    authority: explicitMeta?.authority || 'REGULATOR',
    jurisdiction: explicitMeta?.jurisdiction || 'GLOBAL',
    region: explicitMeta?.region || 'GLOBAL',
    sourceUrl: explicitMeta?.sourceUrl || inputPathOrUrl,
    documentUrl: explicitMeta?.documentUrl || inputPathOrUrl,
    publicationDate: explicitMeta?.publicationDate || new Date().toISOString(),
    effectiveDate: explicitMeta?.effectiveDate || null,
    referenceNumber: explicitMeta?.referenceNumber || null,
    documentType: explicitMeta?.documentType || 'Circular'
  };

  const parsed = regulatoryHtmlParser.parse(htmlContent, metadata);

  console.log(`Parsed '${parsed.document.title}':`);
  console.log(`  • Sections (cp1):    ${parsed.sections.length}`);
  console.log(`  • Paragraphs (cp2):  ${parsed.paragraphs.length}`);

  const res = await supabaseService.ingestHierarchy(parsed);
  console.log(`Successfully ingested into Supabase! Document ID: ${res.documentId}\n`);
  return res;
}

async function ingestAllLocalRegulations() {
  console.log('================================================================');
  console.log(' SUPABASE BATCH INGESTION: ALL DOWNLOADED REGULATIONS');
  console.log('================================================================\n');

  const publications = await localStorageService.getPublications();
  console.log(`Discovered ${publications.length} publications in local storage metadata.\n`);

  let successCount = 0;
  let totalSections = 0;
  let totalParagraphs = 0;
  const summary: any[] = [];

  for (const pub of publications) {
    if (!pub.filePath) continue;
    const absPath = localStorageService.toAbsolutePath(pub.filePath);
    if (!absPath || !fs.existsSync(absPath)) continue;

    const htmlContent = await fs.promises.readFile(absPath, 'utf8');
    const parsed = regulatoryHtmlParser.parse(htmlContent, {
      id: pub.id,
      title: pub.title,
      authority: pub.authority,
      jurisdiction: pub.jurisdiction,
      sourceUrl: pub.sourceUrl,
      documentUrl: pub.documentUrl,
      publicationDate: pub.publicationDate,
      effectiveDate: pub.effectiveDate,
      referenceNumber: pub.referenceNumber,
      documentType: pub.documentType,
      contentHash: pub.contentHash
    });

    try {
      const res = await supabaseService.ingestHierarchy(parsed);
      successCount++;
      totalSections += res.sectionsCount;
      totalParagraphs += res.paragraphsCount;

      summary.push({
        Authority: pub.authority,
        Jurisdiction: pub.jurisdiction,
        DocID: pub.id,
        Sections: res.sectionsCount,
        Paragraphs: res.paragraphsCount,
        Title: pub.title.length > 40 ? pub.title.slice(0, 37) + '...' : pub.title
      });
    } catch (err: any) {
      console.error(`Failed to ingest ${pub.id}:`, err.message);
    }
  }

  console.table(summary);
  console.log('\n--- BATCH INGESTION COMPLETE ---');
  console.log(`Total Documents Ingested: ${successCount} / ${publications.length}`);
  console.log(`Total Sections (cp1):     ${totalSections}`);
  console.log(`Total Paragraphs (cp2):   ${totalParagraphs}`);
  console.log('Deterministic relational context is now available in Supabase for Ollama!\n');
}

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('================================================================');
    console.error(' SUPABASE NOT CONFIGURED');
    console.error('================================================================');
    console.error('Please configure your Supabase connection in .env:');
    console.error('  SUPABASE_URL=https://your-project.supabase.co');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n');
    console.error('First run the SQL migration in supabase/schema.sql in your Supabase SQL Editor.');
    console.error('================================================================\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const target = args[0];

  if (!target || target === '--all') {
    await ingestAllLocalRegulations();
  } else {
    await ingestSingleHtml(target);
  }
}

main().catch((err) => {
  console.error('Ingestion failed:', err.message);
  process.exit(1);
});
