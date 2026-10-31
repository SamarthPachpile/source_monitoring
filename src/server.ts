import { app } from './app';
import { config } from './config/env';
import { logger } from './utils/logger';
import { localStorageService } from './storage/local-storage';
import { regulatoryCronScheduler } from './regulatory/scheduler/regulatory.cron';

function startServer() {
  // 1. Ensure storage directories exist
  localStorageService.initDirectories();

  // 2. Start HTTP server
  const server = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        env: config.NODE_ENV,
        dataDir: config.DATA_DIR,
        cronEnabled: config.REGULATORY_CRON_ENABLED
      },
      `Regulatory Data Ingestion Server running at http://localhost:${config.PORT}`
    );

    // 3. Start cron scheduler
    regulatoryCronScheduler.init();
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    regulatoryCronScheduler.stop();

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit if close takes too long
    setTimeout(() => {
      logger.warn('Forced shutdown due to timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { startServer };
