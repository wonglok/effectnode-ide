import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  getHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from 'h3';
import type { AuthStatusResponse } from '../../shared/types';

const JWT_ALGORITHM = 'HS256';
const JWT_VERSION = 1;
const JWT_ISSUER = 'forge';
const JWT_AUDIENCE = 'sandbox-ide';
const MAX_TOKEN_LENGTH = 4096;

interface JwtPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  v: number;
}

/** The gate is off when no password is configured. */
function password(): string {
  return (process.env.FORGE_PASSWORD ?? '').trim();
}

export function isAuthRequired(): boolean {
  return password().length > 0;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Hash both sides so the comparison is constant-time and length-agnostic. */
function safeMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

/**
 * Signing key for the no-expiry JWT. Prefer an explicit secret so rotating the
 * password does not necessarily invalidate every issued token; when it is
 * absent, derive one from the password so that changing the password revokes
 * existing sessions.
 */
function jwtSecret(): Buffer {
  const explicit = (process.env.FORGE_JWT_SECRET ?? '').trim();
  if (explicit) return Buffer.from(explicit, 'utf8');
  return createHmac('sha256', password()).update('forge-jwt-v1').digest();
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sign(input: string): string {
  return createHmac('sha256', jwtSecret()).update(input).digest('base64url');
}

/** Issue a signed JWT with no `exp` claim. */
export function issueJwt(): string {
  const header = encode({ alg: JWT_ALGORITHM, typ: 'JWT' });
  const payload: JwtPayload = {
    sub: 'forge',
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: Math.floor(Date.now() / 1000),
    v: JWT_VERSION,
  };
  const body = encode(payload);
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

export function verifyJwt(token: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signature] = parts;
  if (!headerPart || !payloadPart || !signature) return false;

  // Always verify HS256, regardless of what the header claims.
  if (!safeMatch(signature, sign(`${headerPart}.${payloadPart}`))) return false;

  const header = decode(headerPart);
  if (!header || header.alg !== JWT_ALGORITHM || header.typ !== 'JWT') return false;

  const payload = decode(payloadPart);
  if (!payload) return false;
  if (payload.sub !== 'forge') return false;
  if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return false;
  if (payload.v !== JWT_VERSION) return false;
  if (typeof payload.iat !== 'number') return false;

  // Deliberately no `exp` check: Forge tokens do not expire.
  return true;
}

function tokenFromRequest(event: H3Event): string | null {
  const header = (getHeader(event, 'authorization') ?? '').trim();
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** True when the gate is disabled or the request carries a valid Forge JWT. */
export function isAuthenticated(event: H3Event): boolean {
  if (!isAuthRequired()) return true;
  const token = tokenFromRequest(event);
  return token !== null && verifyJwt(token);
}

/**
 * Mark the request as unauthenticated and return the JSON error body.
 *
 * The body is drained first so a rejected POST does not leave its request
 * stream unread. We use 403 in development instead of 401 because Nitro 3's
 * Vite dev worker crashes when a POST receives a 401 response; production
 * keeps the standard 401. The header lets the client recognize this as an
 * auth failure rather than an upstream provider error.
 */
export async function authGuard(event: H3Event): Promise<{ message: string } | null> {
  if (isAuthenticated(event)) return null;

  const production = process.env.NODE_ENV === 'production';
  const method = event.req.method.toUpperCase();
  if (!production && method !== 'GET' && method !== 'HEAD') {
    await readBody(event).catch(() => undefined);
  }

  const status = production ? 401 : 403;
  setResponseStatus(event, status);
  setResponseHeader(event, 'X-Forge-Auth', 'required');
  return { message: 'Sign in is required.' };
}

export function authStatus(event: H3Event): AuthStatusResponse {
  return { required: isAuthRequired(), unlocked: isAuthenticated(event) };
}

export function verifyPassword(candidate: string): boolean {
  const secret = password();
  return secret.length > 0 && safeMatch(candidate, secret);
}
