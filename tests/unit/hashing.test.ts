import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sha256, sha256File, generateDocumentId } from '../../src/utils/hashing';

describe('Hashing & ID Generation', () => {
  const testFile = path.join(__dirname, 'test-hash.txt');

  beforeAll(async () => {
    await fs.promises.writeFile(testFile, 'Regulatory Content Test Buffer', 'utf8');
  });

  afterAll(async () => {
    if (fs.existsSync(testFile)) {
      await fs.promises.unlink(testFile);
    }
  });

  it('calculates deterministic SHA-256 for strings and buffers', () => {
    const hash1 = sha256('Regulatory Content Test Buffer');
    const hash2 = sha256(Buffer.from('Regulatory Content Test Buffer'));
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('calculates SHA-256 from a file stream', async () => {
    const fileHash = await sha256File(testFile);
    const directHash = sha256('Regulatory Content Test Buffer');
    expect(fileHash).toBe(directHash);
  });

  it('generates deterministic, sanitized document IDs', () => {
    const id1 = generateDocumentId('RBI', 'https://rbi.org.in/notice/1');
    const id2 = generateDocumentId('rbi', 'https://rbi.org.in/notice/1');
    const idDiff = generateDocumentId('rbi', 'https://rbi.org.in/notice/2');

    expect(id1).toBe(id2);
    expect(id1.startsWith('rbi-')).toBe(true);
    expect(id1).not.toBe(idDiff);
    // Safe characters only
    expect(id1).toMatch(/^[a-z0-9_-]+$/);
  });
});
