import { Router, Request, Response, NextFunction } from 'express';
import { localStorageService } from '../storage/local-storage';
import { sourceRegistry } from '../regulatory/registry';

export const sourcesRouter = Router();

sourcesRouter.get('/sources', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let sources = await localStorageService.getSources();
    if (sources.length === 0) {
      // Initialize with default registry sources
      sources = sourceRegistry.getInitialSourceHealthList();
      await localStorageService.saveSources(sources);
    }

    res.json({
      success: true,
      data: sources
    });
  } catch (err) {
    next(err);
  }
});
