import path from 'path';
import { SecurityError } from './errors';

// Allowed official regulatory domains and subdomains
export const ALLOWED_DOMAINS = [
  'sama.gov.sa',
  'rulebook.sama.gov.sa',
  'www.sama.gov.sa',
  'centralbank.ae',
  'rulebook.centralbank.ae',
  'www.centralbank.ae',
  'rbi.org.in',
  'www.rbi.org.in',
  'rbidocs.rbi.org.in',
  'systemhealth.rbi.org.in',
  'centralbank.go.ke',
  'www.centralbank.go.ke'
];

// Disallowed hostnames and IP ranges (SSRF protection)
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'instance-data'
];

/**
 * Checks if an IP or host is in private/reserved ranges
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(lower)) {
    return true;
  }

  // Check IPv4 private and link-local ranges
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = lower.match(ipv4Regex);
  if (match) {
    const [_, b1, b2] = match.map(Number);
    if (b1 === 10) return true; // 10.0.0.0/8
    if (b1 === 127) return true; // 127.0.0.0/8
    if (b1 === 169 && b2 === 254) return true; // 169.254.0.0/16
    if (b1 === 172 && b2 >= 16 && b2 <= 31) return true; // 172.16.0.0/12
    if (b1 === 192 && b2 === 168) return true; // 192.168.0.0/16
    if (b1 === 0) return true; // 0.0.0.0/8
  }

  // Check IPv6 loopback / unique local
  if (lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
    return true;
  }

  return false;
}

/**
 * Validates a URL against regulatory allowlist and SSRF rules.
 * @param urlString The URL to validate
 * @param customAllowedDomains Optional domain override for tests
 */
export function validateRegulatoryUrl(urlString: string, customAllowedDomains?: string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new SecurityError(`Invalid URL format: ${urlString}`);
  }

  // Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SecurityError(`Unsupported protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // SSRF check
  if (isPrivateOrReservedHost(hostname)) {
    throw new SecurityError(`SSRF blocked: host ${hostname} is private or reserved`);
  }

  // Domain allowlist check
  const domains = customAllowedDomains || ALLOWED_DOMAINS;
  const isAllowed = domains.some((allowed) => {
    return hostname === allowed || hostname.endsWith(`.${allowed}`);
  });

  if (!isAllowed) {
    throw new SecurityError(`Domain not in regulatory allowlist: ${hostname}`);
  }

  return parsed;
}

/**
 * Ensure a file path remains strictly inside the target base directory (prevent path traversal).
 */
export function assertSafePath(targetPath: string, baseDir: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);

  // Normalize Windows paths for case sensitivity and trailing slashes
  const normalizedBase = path.normalize(resolvedBase).toLowerCase();
  const normalizedTarget = path.normalize(resolvedTarget).toLowerCase();

  if (!normalizedTarget.startsWith(normalizedBase)) {
    throw new SecurityError(`Path traversal attempt blocked: ${targetPath}`);
  }

  return resolvedTarget;
}

/**
 * Sanitizes an ID or file name component to prevent path traversal
 */
export function sanitizePathComponent(name: string): string {
  return name.replace(/\./g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
}
