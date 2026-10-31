import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { UnauthorizedError } from '../utils/errors';

export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const apiKeyHeader = req.headers['x-api-key'];

  if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
    throw new UnauthorizedError('Missing required x-api-key header');
  }

  // Constant-time-like comparison
  if (apiKeyHeader.trim() !== config.REGULATORY_API_KEY.trim()) {
    throw new UnauthorizedError('Invalid API key provided');
  }

  next();
}
