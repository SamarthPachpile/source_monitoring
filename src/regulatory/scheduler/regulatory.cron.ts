import cron, { ScheduledTask } from 'node-cron';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { monitoringService } from '../services/monitoring.service';

export class RegulatoryCronScheduler {
  private static instance: RegulatoryCronScheduler;
  private task: ScheduledTask | null = null;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): RegulatoryCronScheduler {
    if (!RegulatoryCronScheduler.instance) {
      RegulatoryCronScheduler.instance = new RegulatoryCronScheduler();
    }
    return RegulatoryCronScheduler.instance;
  }

  public init(): void {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    if (!config.REGULATORY_CRON_ENABLED) {
      logger.info('Regulatory cron scheduler is disabled via configuration');
      return;
    }

    if (!cron.validate(config.REGULATORY_CRON_EXPRESSION)) {
      logger.error(
        { expression: config.REGULATORY_CRON_EXPRESSION },
        'Invalid cron expression for regulatory monitoring'
      );
      throw new Error(`Invalid cron expression: ${config.REGULATORY_CRON_EXPRESSION}`);
    }

    this.task = cron.schedule(config.REGULATORY_CRON_EXPRESSION, async () => {
      logger.info('Scheduled regulatory monitoring trigger fired');
      try {
        await monitoringService.runMonitoringCycle({ triggeredBy: 'cron' });
      } catch (err: any) {
        if (err.statusCode === 409) {
          logger.warn('Scheduled monitoring cycle skipped: another cycle is already running');
        } else {
          logger.error({ error: err.message }, 'Scheduled monitoring cycle encountered an error');
        }
      }
    });

    logger.info(
      { expression: config.REGULATORY_CRON_EXPRESSION, runOnStartup: config.REGULATORY_RUN_ON_STARTUP },
      'Regulatory cron scheduler initialized'
    );

    if (config.REGULATORY_RUN_ON_STARTUP) {
      logger.info('Triggering immediate monitoring run on startup');
      monitoringService
        .runMonitoringCycle({ triggeredBy: 'cron' })
        .catch((err) => logger.error({ error: err.message }, 'Startup monitoring cycle failed'));
    }
  }

  public stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.isInitialized = false;
    logger.info('Regulatory cron scheduler stopped');
  }

  public isRunning(): boolean {
    return this.task !== null;
  }
}

export const regulatoryCronScheduler = RegulatoryCronScheduler.getInstance();
