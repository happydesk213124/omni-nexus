/**
 * Request plumbing shared by the router: query parsing and auth.
 */

import { cleanText } from '../core/util/text';
import type { Settings } from '../core/types';

export type QueryValue = string | string[];
export type Query = Record<string, QueryValue>;

export interface ParsedPath {
  pathname: string;
  query: Query;
}

/** Repeated keys collapse into an array, matching URLSearchParams semantics. */
export function parseQuery(path: string): ParsedPath {
  const qIdx = path.indexOf('?');
  if (qIdx < 0) return { pathname: path, query: {} };
  const pathname = path.slice(0, qIdx);
  const params = new URLSearchParams(path.slice(qIdx + 1));
  const query: Query = {};
  for (const [k, v] of params.entries()) {
    const existing = query[k];
    if (existing === undefined) query[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else query[k] = [existing, v];
  }
  return { pathname, query };
}

/** First value for a query key, with a default. Repeated keys take the first. */
export function q(query: Query, key: string, fallback = ''): string {
  const v = query[key];
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

/**
 * Every value for a query key. Accepts both a repeated key and one
 * comma-separated value, since a URL builder may produce either.
 */
export function qAll(query: Query, key: string): string[] {
  const v = query[key];
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of String(entry).split(',')) {
      const clean = part.trim();
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

export type Headers = Record<string, unknown>;

/**
 * Validates the optional bearer token.
 *
 * The comparison is length-checked then constant-time over the whole string: an
 * early-exit compare would leak the token one byte at a time to anything that
 * can time requests, and the UI shares an origin with untrusted chat content.
 */
export function authorized(config: Settings, headers: Headers = {}): boolean {
  const expected = cleanText(config.auth_token, 4000);
  if (!expected) return true;
  const authorization = String(headers.Authorization || headers.authorization || '');
  let supplied = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : authorization;
  supplied = supplied || String(headers['X-Inlay-Nexus-Token'] || headers['x-inlay-nexus-token'] || '');
  if (typeof supplied !== 'string') return false;
  if (supplied.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i += 1) ok |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return ok === 0;
}
