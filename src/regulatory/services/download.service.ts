import fs from 'fs';
import path from 'path';
import axios, { AxiosResponse } from 'axios';
import { config } from '../../config/env';
import { validateRegulatoryUrl } from '../../utils/url-validation';
import { sha256File } from '../../utils/hashing';
import { logger } from '../../utils/logger';
import { SecurityError, AppError } from '../../utils/errors';

export interface DownloadResult {
  tempFilePath: string;
  contentHash: string;
  fileSizeBytes: number;
  mimeType: string;
  extension: string;
}

export class DownloadService {
  private customAllowedDomains?: string[];

  constructor(customAllowedDomains?: string[]) {
    this.customAllowedDomains = customAllowedDomains;
  }

  /**
   * Determine file extension safely based on magic bytes and Content-Type header
   */
  private determineExtension(bufferSample: Buffer, contentType?: string): { extension: string; mimeType: string } {
    const ct = (contentType || '').toLowerCase();

    // Check magic bytes
    if (bufferSample.length >= 4 && bufferSample.toString('utf8', 0, 4) === '%PDF') {
      return { extension: 'pdf', mimeType: 'application/pdf' };
    }
    if (
      bufferSample.length >= 4 &&
      bufferSample[0] === 0x50 &&
      bufferSample[1] === 0x4b &&
      bufferSample[2] === 0x03 &&
      bufferSample[3] === 0x04
    ) {
      return {
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
    }

    const sampleText = bufferSample.toString('utf8', 0, Math.min(bufferSample.length, 500)).toLowerCase();
    if (sampleText.includes('<html') || sampleText.includes('<!doctype html') || ct.includes('html')) {
      return { extension: 'html', mimeType: 'text/html' };
    }

    if (ct.includes('pdf')) {
      return { extension: 'pdf', mimeType: 'application/pdf' };
    }
    if (ct.includes('plain')) {
      return { extension: 'txt', mimeType: 'text/plain' };
    }

    return { extension: 'bin', mimeType: ct || 'application/octet-stream' };
  }

  /**
   * Securely download a document to a temporary file
   */
  public async downloadFile(documentUrl: string): Promise<DownloadResult> {
    // Initial URL validation
    validateRegulatoryUrl(documentUrl, this.customAllowedDomains);

    const maxBytes = config.REGULATORY_MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
    const timeout = config.REGULATORY_HTTP_TIMEOUT_MS;
    const maxRetries = config.REGULATORY_MAX_RETRIES;

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      attempt++;
      const tempPath = path.join(
        config.DATA_DIR,
        `download-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
      );

      try {
        const response: AxiosResponse = await axios({
          method: 'GET',
          url: documentUrl,
          responseType: 'stream',
          timeout,
          maxRedirects: 5,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'application/pdf,application/xhtml+xml,text/html,*/*;q=0.8'
          },
          beforeRedirect: (options) => {
            // Revalidate every redirect against allowlist and SSRF rules!
            const redirectUrl = options.href || `${options.protocol}//${options.host}${options.path}`;
            validateRegulatoryUrl(redirectUrl, this.customAllowedDomains);
          }
        });

        const contentType = typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type']
          : undefined;
        let downloadedBytes = 0;
        let firstChunk: Buffer | null = null;

        const writer = fs.createWriteStream(tempPath);

        await new Promise<void>((resolve, reject) => {
          response.data.on('data', (chunk: Buffer) => {
            if (!firstChunk && chunk.length > 0) {
              firstChunk = chunk.slice(0, 512);
            }
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxBytes) {
              response.data.destroy();
              writer.destroy();
              reject(
                new SecurityError(
                  `Document size exceeds limit of ${config.REGULATORY_MAX_DOCUMENT_SIZE_MB}MB`
                )
              );
            }
          });

          response.data.pipe(writer);

          writer.on('finish', () => resolve());
          writer.on('error', (err) => reject(err));
          response.data.on('error', (err: any) => reject(err));
        });

        // Compute hash
        const contentHash = await sha256File(tempPath);
        const { extension, mimeType } = this.determineExtension(
          firstChunk || Buffer.alloc(0),
          contentType
        );

        logger.info(
          { documentUrl, sizeBytes: downloadedBytes, extension, contentHash },
          'Document downloaded successfully'
        );

        return {
          tempFilePath: tempPath,
          contentHash,
          fileSizeBytes: downloadedBytes,
          mimeType,
          extension
        };
      } catch (err: any) {
        lastError = err;
        // Clean up temporary file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        // Do not retry on security errors or validation errors
        if (err instanceof SecurityError) {
          throw err;
        }

        logger.warn(
          { documentUrl, attempt, maxRetries, error: err.message },
          'Document download attempt failed'
        );

        if (attempt <= maxRetries) {
          // Exponential backoff
          await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 5000)));
        }
      }
    }

    throw new AppError(
      `Failed to download document after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`
    );
  }
}

export const downloadService = new DownloadService();
