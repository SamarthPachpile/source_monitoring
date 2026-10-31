import { StoredPublication } from '../types';

export type DeduplicationStatus = 'NEW' | 'EXISTS';

export interface DeduplicationCheckResult {
  status: DeduplicationStatus;
  existingPublication: StoredPublication | null;
}

export class DeduplicationService {
  /**
   * Find an existing publication using multi-signal matching:
   * 1. Exact ID
   * 2. Regulatory reference number within same authority & jurisdiction
   * 3. Normalized document URL
   */
  public findMatch(
    candidate: StoredPublication,
    existingList: StoredPublication[]
  ): StoredPublication | null {
    for (const existing of existingList) {
      // 1. Direct ID match
      if (existing.id === candidate.id) {
        return existing;
      }

      // 2. Exact reference number match (if present and same authority)
      if (
        candidate.referenceNumber &&
        existing.referenceNumber &&
        candidate.authority === existing.authority &&
        candidate.jurisdiction === existing.jurisdiction &&
        candidate.referenceNumber.toLowerCase().trim() ===
          existing.referenceNumber.toLowerCase().trim()
      ) {
        return existing;
      }

      // 3. Normalized document URL match
      if (
        candidate.documentUrl &&
        existing.documentUrl &&
        candidate.documentUrl.toLowerCase().trim() === existing.documentUrl.toLowerCase().trim()
      ) {
        return existing;
      }
    }

    return null;
  }

  /**
   * Check whether a discovered publication is new or already tracked
   */
  public check(
    candidate: StoredPublication,
    existingList: StoredPublication[]
  ): DeduplicationCheckResult {
    const existing = this.findMatch(candidate, existingList);
    if (!existing) {
      return { status: 'NEW', existingPublication: null };
    }
    return { status: 'EXISTS', existingPublication: existing };
  }

  /**
   * Compare content hashes to determine if a downloaded document has changed
   */
  public isContentModified(existingHash: string | null, newHash: string): boolean {
    if (!existingHash) return true;
    return existingHash.toLowerCase() !== newHash.toLowerCase();
  }
}

export const deduplicationService = new DeduplicationService();
