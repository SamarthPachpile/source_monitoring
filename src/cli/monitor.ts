import { localStorageService } from '../storage/local-storage';
import { monitoringService } from '../regulatory/services/monitoring.service';
import { logger } from '../utils/logger';

async function main() {
  console.log('--- CLI: Triggering Regulatory Monitoring Cycle ---');
  localStorageService.initDirectories();

  // Parse optional --source=xyz argument
  let targetSourceKey: string | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--source=')) {
      targetSourceKey = arg.replace('--source=', '').trim();
    }
  }

  try {
    const run = await monitoringService.runMonitoringCycle({
      triggeredBy: 'cli',
      targetSourceKey
    });

    console.log('\n--- Monitoring Run Completed ---');
    console.log(`Run ID:            ${run.id}`);
    console.log(`Status:            ${run.status}`);
    console.log(`Sources Checked:   ${run.sourcesChecked.join(', ')}`);
    console.log(`Discovered:        ${run.discoveredCount}`);
    console.log(`New Documents:     ${run.newCount}`);
    console.log(`Updated Documents: ${run.updatedCount}`);
    console.log(`Skipped Duplicates:${run.skippedCount}`);
    console.log(`Failed Downloads:  ${run.failedDownloads}`);
    console.log(`Failed Extractions:${run.failedExtractions}`);

    if (run.error) {
      console.error(`Error:             ${run.error}`);
    }

    console.log('\nPer-source breakdown:');
    for (const [key, res] of Object.entries(run.sourceResults)) {
      console.log(`  [${key.toUpperCase()}]: status=${res.status}, discovered=${res.discovered}, new=${res.new}, skipped=${res.skipped}, failedDownloads=${res.failedDownloads}`);
      if (res.errors.length > 0) {
        console.log(`    Errors: ${res.errors.join('; ')}`);
      }
    }

    process.exit(run.status === 'completed' ? 0 : 1);
  } catch (err: any) {
    console.error('\nCLI Monitoring Error:', err.message);
    process.exit(1);
  }
}

main();
