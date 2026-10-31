import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

// Ensure logs directory exists
try {
  if (!fs.existsSync(config.LOGS_DIR)) {
    fs.mkdirSync(config.LOGS_DIR, { recursive: true });
  }
} catch {
  // Directory will be created during server initialization
}

const streams: pino.StreamEntry[] = [
  {
    level: 'info',
    stream: process.stdout
  }
];

try {
  const logFile = path.join(config.LOGS_DIR, 'app.log');
  const fileStream = fs.createWriteStream(logFile, { flags: 'a' });
  streams.push({
    level: 'info',
    stream: fileStream
  });
} catch {
  // Console logging fallback if file write fails
}

export const logger = pino(
  {
    level: config.NODE_ENV === 'test' ? 'silent' : 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['headers.x-api-key', 'headers.authorization', 'apiKey', 'token', 'secret'],
      censor: '***REDACTED***'
    }
  },
  pino.multistream(streams)
);
