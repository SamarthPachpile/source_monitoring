import crypto from 'crypto';
import fs from 'fs';

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Generate a safe, deterministic document ID from sourceKey and unique seed (URL or reference number)
 * Example: sama-a1b2c3d4e5f6
 */
export function generateDocumentId(sourceKey: string, seed: string): string {
  const sanitizedSource = sourceKey.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const hash = sha256(seed.trim()).slice(0, 16);
  return `${sanitizedSource}-${hash}`;
}
