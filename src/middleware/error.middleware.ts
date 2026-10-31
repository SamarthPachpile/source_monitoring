import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500) {
    logger.error({ error: err.stack || err.message, statusCode }, 'Internal server error');
  } else {
    logger.warn({ error: message, statusCode }, 'Client error occurred');
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode
    }
  });
}
