import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { requireApiKey } from '../middleware/auth.middleware';
import { monitoringService } from '../regulatory/services/monitoring.service';
import { localStorageService } from '../storage/local-storage';
import { sourceRegistry } from '../regulatory/registry';
import { NotFoundError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const monitoringRouter = Router();

/**
 * Trigger monitoring cycle for all sources
 */
monitoringRouter.post(
  '/monitoring/run',
  requireApiKey,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (monitoringService.getIsRunning()) {
        return res.status(409).json({
          success: false,
          message: 'A monitoring run is already in progress',
          data: {
            runId: monitoringService.getCurrentRunId(),
            status: 'running'
          }
        });
      }

      // Generate runId immediately
      const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      // Start asynchronous monitoring cycle without blocking response
      monitoringService
        .runMonitoringCycle({
          triggeredBy: 'manual'
        })
        .catch((err) => {
          logger.error({ error: err.message }, 'Background monitoring run encountered error');
        });

      return res.status(202).json({
        success: true,
        message: 'Monitoring run started',
        data: {
          runId: monitoringService.getCurrentRunId() || runId,
          status: 'running'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Trigger monitoring cycle for a specific source
 */
monitoringRouter.post(
  '/monitoring/run/:sourceKey',
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sourceKey = (req.params.sourceKey as string).toLowerCase();
      const adapter = sourceRegistry.getAdapter(sourceKey);

      if (!adapter) {
        throw new NotFoundError(
          `Unknown regulatory source: '${sourceKey}'. Valid sources are: ${sourceRegistry
            .getAllAdapters()
            .map((a) => a.sourceKey)
            .join(', ')}`
        );
      }

      if (monitoringService.getIsRunning()) {
        return res.status(409).json({
          success: false,
          message: 'A monitoring run is already in progress',
          data: {
            runId: monitoringService.getCurrentRunId(),
            status: 'running'
          }
        });
      }

      const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      // Start asynchronous monitoring cycle for single source
      monitoringService
        .runMonitoringCycle({
          triggeredBy: 'manual',
          targetSourceKey: sourceKey
        })
        .catch((err) => {
          logger.error({ sourceKey, error: err.message }, 'Background single-source monitoring run failed');
        });

      return res.status(202).json({
        success: true,
        message: `Monitoring run started for source '${sourceKey}'`,
        data: {
          runId: monitoringService.getCurrentRunId() || runId,
          sourceKey,
          status: 'running'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Get paginated list of monitoring runs
 */
monitoringRouter.get(
  '/monitoring/runs',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
      const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

      const { runs, total } = await localStorageService.getMonitoringRuns(limit, offset);

      res.json({
        success: true,
        data: {
          runs,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + runs.length < total
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Get single monitoring run status
 */
monitoringRouter.get(
  '/monitoring/runs/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const runId = req.params.runId as string;
      const run = await localStorageService.getMonitoringRunById(runId);
      if (!run) {
        throw new NotFoundError(`Monitoring run '${runId}' not found`);
      }

      res.json({
        success: true,
        data: run
      });
    } catch (err) {
      next(err);
    }
  }
);
