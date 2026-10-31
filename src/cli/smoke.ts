import axios from 'axios';
import { sourceRegistry } from '../regulatory/registry';

interface SmokeReport {
  sourceKey: string;
  authority: string;
  jurisdiction: string;
  url: string;
  httpStatus: number | string;
  reachable: boolean;
  discoverySuccess: boolean;
  discoveredCount: number;
  sampleTitle?: string;
  sampleDocumentUrl?: string;
  note?: string;
}

async function runSmokeTests() {
  console.log('================================================================');
  console.log(' LIVE REGULATORY SOURCE SMOKE TEST');
  console.log('================================================================\n');

  const adapters = sourceRegistry.getAllAdapters();
  const reports: SmokeReport[] = [];

  for (const adapter of adapters) {
    console.log(`Testing [${adapter.authority} / ${adapter.jurisdiction}] starting at: ${adapter.startingUrl}...`);
    
    let httpStatus: number | string = 'UNKNOWN';
    let reachable = false;
    let discoverySuccess = false;
    let discoveredCount = 0;
    let sampleTitle: string | undefined;
    let sampleDocumentUrl: string | undefined;
    let note: string | undefined;

    // 1. Connectivity test
    try {
      const ping = await axios.get(adapter.startingUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 15000,
        validateStatus: () => true
      });
      httpStatus = ping.status;
      reachable = ping.status >= 200 && ping.status < 400;
    } catch (err: any) {
      httpStatus = err.code || err.message;
      reachable = false;
    }

    // 2. Discover test
    try {
      const publications = await adapter.discover();
      discoverySuccess = true;
      discoveredCount = publications.length;
      if (publications.length > 0) {
        sampleTitle = publications[0].title;
        sampleDocumentUrl = publications[0].documentUrl;
      }
    } catch (err: any) {
      discoverySuccess = false;
      note = err.message;
    }

    reports.push({
      sourceKey: adapter.sourceKey,
      authority: adapter.authority,
      jurisdiction: adapter.jurisdiction,
      url: adapter.startingUrl,
      httpStatus,
      reachable,
      discoverySuccess,
      discoveredCount,
      sampleTitle,
      sampleDocumentUrl,
      note
    });

    console.log(`  -> Reachable: ${reachable} (HTTP ${httpStatus})`);
    console.log(`  -> Discovery: ${discoverySuccess ? 'SUCCESS' : 'FAILED'} (Discovered: ${discoveredCount})`);
    if (sampleTitle) {
      console.log(`  -> Sample: "${sampleTitle.slice(0, 70)}..."`);
    }
    if (note) {
      console.log(`  -> Note: ${note}`);
    }
    console.log('');
  }

  console.log('================================================================');
  console.log(' SUMMARY TABLE');
  console.log('================================================================');
  console.table(
    reports.map((r) => ({
      Authority: r.authority,
      Jurisdiction: r.jurisdiction,
      HTTP: r.httpStatus,
      Reachable: r.reachable ? 'YES' : 'NO',
      Discovered: r.discoveredCount,
      Status: r.discoverySuccess && r.discoveredCount > 0 ? 'PASS' : 'WARN'
    }))
  );
}

runSmokeTests().catch(console.error);
