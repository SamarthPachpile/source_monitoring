import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import cron from 'node-cron';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REGULATORY_CRON_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === undefined || val === '1'),
  REGULATORY_CRON_EXPRESSION: z
    .string()
    .default('*/15 * * * *')
    .refine((val) => cron.validate(val), {
      message: 'Invalid cron expression'
    }),
  REGULATORY_RUN_ON_STARTUP: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  REGULATORY_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  REGULATORY_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  REGULATORY_MAX_DOCUMENT_SIZE_MB: z.coerce.number().positive().default(25),
  REGULATORY_MAX_CONCURRENT_SOURCES: z.coerce.number().int().positive().default(4),
  REGULATORY_MAX_ITEMS_PER_SOURCE: z.coerce.number().int().positive().default(10),
  REGULATORY_DATA_DIR: z.string().default('./data'),
  REGULATORY_API_KEY: z.string().default('replace-with-a-local-development-key'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_KEY: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment configuration error:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

const rawConfig = parsed.data;

// Fail securely in production if API key is missing or default
if (
  rawConfig.NODE_ENV === 'production' &&
  (!rawConfig.REGULATORY_API_KEY ||
    rawConfig.REGULATORY_API_KEY === 'replace-with-a-local-development-key')
) {
  throw new Error('REGULATORY_API_KEY must be securely configured in production');
}

// Stable project root derived from directory location
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.isAbsolute(rawConfig.REGULATORY_DATA_DIR)
  ? rawConfig.REGULATORY_DATA_DIR
  : path.resolve(PROJECT_ROOT, rawConfig.REGULATORY_DATA_DIR);

export const config = {
  ...rawConfig,
  PROJECT_ROOT,
  DATA_DIR,
  REGULATIONS_DIR: path.join(DATA_DIR, 'regulations'),
  METADATA_DIR: path.join(DATA_DIR, 'metadata'),
  EXTRACTED_DIR: path.join(DATA_DIR, 'extracted'),
  LOGS_DIR: path.join(DATA_DIR, 'logs')
};

export type Config = typeof config;
