export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing API key') {
    super(message, 401);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

export class SecurityError extends AppError {
  constructor(message = 'Security violation detected') {
    super(message, 403);
  }
}

export class SourceExtractionError extends AppError {
  public readonly sourceKey: string;
  constructor(sourceKey: string, message: string) {
    super(`[${sourceKey}] Extraction failure: ${message}`, 502);
    this.sourceKey = sourceKey;
  }
}
