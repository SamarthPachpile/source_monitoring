import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  validateRegulatoryUrl,
  isPrivateOrReservedHost,
  assertSafePath,
  sanitizePathComponent
} from '../../src/utils/url-validation';
import { SecurityError } from '../../src/utils/errors';

describe('URL Validation & Security Controls', () => {
  it('allows approved regulatory domains', () => {
    expect(() =>
      validateRegulatoryUrl('https://rulebook.sama.gov.sa/en/sama-circulars')
    ).not.toThrow();

    expect(() =>
      validateRegulatoryUrl('https://www.rbi.org.in/notifications_rss.xml')
    ).not.toThrow();

    expect(() =>
      validateRegulatoryUrl('https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT303.PDF')
    ).not.toThrow();

    expect(() =>
      validateRegulatoryUrl('https://rulebook.centralbank.ae/en/rulebook/banking')
    ).not.toThrow();

    expect(() =>
      validateRegulatoryUrl('https://www.centralbank.go.ke/uploads/banking_circulars/test.pdf')
    ).not.toThrow();
  });

  it('rejects unapproved external domains', () => {
    expect(() => validateRegulatoryUrl('https://malicious-site.example/doc.pdf')).toThrow(
      SecurityError
    );
    expect(() => validateRegulatoryUrl('https://google.com')).toThrow(SecurityError);
  });

  it('blocks private IP ranges and localhost (SSRF protection)', () => {
    expect(isPrivateOrReservedHost('localhost')).toBe(true);
    expect(isPrivateOrReservedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedHost('10.0.1.5')).toBe(true);
    expect(isPrivateOrReservedHost('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedHost('172.20.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('metadata.google.internal')).toBe(true);

    expect(() => validateRegulatoryUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      SecurityError
    );
    expect(() => validateRegulatoryUrl('http://127.0.0.1:4000/api/v1/health')).toThrow(
      SecurityError
    );
  });

  it('enforces path traversal protection with assertSafePath', () => {
    const baseDir = path.resolve(__dirname, '../../data');

    // Valid path inside baseDir
    const validPath = path.join(baseDir, 'regulations/IN/doc-1/original.html');
    expect(assertSafePath(validPath, baseDir)).toBe(validPath);

    // Path traversal attempt with ..
    expect(() => assertSafePath('../../etc/passwd', baseDir)).toThrow(SecurityError);
    expect(() =>
      assertSafePath(path.join(baseDir, '../outside-file.txt'), baseDir)
    ).toThrow(SecurityError);
  });

  it('sanitizes path components against dangerous characters', () => {
    expect(sanitizePathComponent('normal-file_name')).toBe('normal-file_name');
    expect(sanitizePathComponent('../../../etc/passwd')).toBe('_________etc_passwd');
    expect(sanitizePathComponent('doc\\windows/traversal')).toBe('doc_windows_traversal');
  });
});
