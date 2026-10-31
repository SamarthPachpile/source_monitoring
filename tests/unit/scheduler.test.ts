import { describe, it, expect, afterEach } from 'vitest';
import { regulatoryCronScheduler } from '../../src/regulatory/scheduler/regulatory.cron';

describe('Regulatory Cron Scheduler', () => {
  afterEach(() => {
    regulatoryCronScheduler.stop();
  });

  it('initializes cleanly and stops gracefully', () => {
    regulatoryCronScheduler.init();
    expect(regulatoryCronScheduler.isRunning()).toBe(true);

    regulatoryCronScheduler.stop();
    expect(regulatoryCronScheduler.isRunning()).toBe(false);
  });

  it('prevents multiple redundant scheduler instances', () => {
    regulatoryCronScheduler.init();
    expect(regulatoryCronScheduler.isRunning()).toBe(true);

    // Call init second time - should be a no-op
    regulatoryCronScheduler.init();
    expect(regulatoryCronScheduler.isRunning()).toBe(true);

    regulatoryCronScheduler.stop();
  });
});
