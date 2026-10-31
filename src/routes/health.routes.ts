import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { localStorageService } from '../storage/local-storage';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const { runs } = await localStorageService.getMonitoringRuns(1, 0);
  const lastRun = runs[0] || null;

  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      cronEnabled: config.REGULATORY_CRON_ENABLED,
      lastMonitoringRun: lastRun ? lastRun.completedAt || lastRun.startedAt : null
    }
  });
});
