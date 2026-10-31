export interface RegulatoryPublication {
  sourceKey: string;
  authority: string;
  jurisdiction: string;
  title: string;
  sourceUrl: string;
  documentUrl: string;
  publicationDate: string | null;
  effectiveDate: string | null;
  referenceNumber: string | null;
  documentType: string | null;
  discoveredAt: string;
}

export interface PublicationVersion {
  version: number;
  contentHash: string;
  filePath: string;
  extractedTextPath: string | null;
  downloadedAt: string;
  fileSizeBytes: number;
}

export type PublicationStatus =
  | 'discovered'
  | 'downloaded'
  | 'missing_locally'
  | 'download_failed'
  | 'extraction_failed'
  | 'requires_ocr';

export interface StoredPublication {
  id: string;
  sourceKey: string;
  authority: string;
  jurisdiction: string;
  title: string;
  sourceUrl: string;
  documentUrl: string;
  publicationDate: string | null;
  effectiveDate: string | null;
  referenceNumber: string | null;
  documentType: string | null;
  filePath: string | null;
  extractedTextPath: string | null;
  contentHash: string | null;
  mimeType: string | null;
  fileSizeBytes: number;
  status: PublicationStatus;
  currentVersion: number;
  versions: PublicationVersion[];
  firstDiscoveredAt: string;
  lastCheckedAt: string;
  lastDownloadedAt: string | null;
  downloadError?: string | null;
  extractionError?: string | null;
}

export interface SourceHealth {
  sourceKey: string;
  authority: string;
  jurisdiction: string;
  region: string;
  startingUrl: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  status: 'healthy' | 'warning' | 'error' | 'not_checked';
  lastError: string | null;
}

export interface SourceRunResult {
  sourceKey: string;
  status: 'success' | 'partial' | 'failed';
  discovered: number;
  new: number;
  updated: number;
  skipped: number;
  failedDownloads: number;
  failedExtractions: number;
  errors: string[];
}

export interface MonitoringRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  triggeredBy: 'cron' | 'manual' | 'cli';
  targetSourceKey: string | null;
  sourcesChecked: string[];
  discoveredCount: number;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  failedDownloads: number;
  failedExtractions: number;
  sourceResults: Record<string, SourceRunResult>;
  error: string | null;
}

export interface StorageStats {
  totalStoredPublications: number;
  totalDownloadedFiles: number;
  totalExtractedTextFiles: number;
  totalStorageSizeBytes: number;
  missingLocallyCount?: number;
  failedDownloadsCount: number;
  failedExtractionsCount: number;
  totalDocumentVersions: number;
}

export interface RegulatorySourceAdapter {
  readonly sourceKey: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly region: string;
  readonly startingUrl: string;

  discover(): Promise<RegulatoryPublication[]>;
}
