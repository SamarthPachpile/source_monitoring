import express from 'express';
import { healthRouter } from './routes/health.routes';
import { sourcesRouter } from './routes/sources.routes';
import { monitoringRouter } from './routes/monitoring.routes';
import { documentsRouter } from './routes/documents.routes';
import { errorHandler } from './middleware/error.middleware';
import { NotFoundError } from './utils/errors';
import { logger } from './utils/logger';

export function createApp(): express.Application {
  const app = express();

  // Basic middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logger (in non-test environments)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path !== '/api/v1/health') {
        logger.info(
          {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            durationMs: duration
          },
          'HTTP Request'
        );
      }
    });
    next();
  });

  // Mount API v1 routes
  const apiRouter = express.Router();
  apiRouter.use(healthRouter);
  apiRouter.use(sourcesRouter);
  apiRouter.use(monitoringRouter);
  apiRouter.use(documentsRouter);

  app.use('/api/v1', apiRouter);

  // 404 handler
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
