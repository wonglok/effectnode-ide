import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, type H3Event } from 'h3';
import type { AuthStatusResponse } from '../../shared/types';

const COOKIE_NAME = 'forge_unlock';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const TOKEN_MESSAGE = 'forge-ui-unlock-v1';

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

/** A stable token derived from the password; changing the password relocks tabs. */
function unlockToken(secret: string): string {
  return createHmac('sha256', secret).update(TOKEN_MESSAGE).digest('hex');
}

export function isUnlocked(event: H3Event): boolean {
  const secret = password();
  if (!secret) return true;

  const cookie = getCookie(event, COOKIE_NAME);
  if (!cookie) return false;
  return safeMatch(cookie, unlockToken(secret));
}

export function authStatus(event: H3Event): AuthStatusResponse {
  return { required: isAuthRequired(), unlocked: isUnlocked(event) };
}

export function verifyPassword(candidate: string): boolean {
  const secret = password();
  return secret.length > 0 && safeMatch(candidate, secret);
}

export function grantUnlock(event: H3Event): void {
  const secret = password();
  if (!secret) return;

  // No `secure` flag: `npm start` serves plain HTTP on localhost. This is a
  // lightweight UI gate, not an account system.
  setCookie(event, COOKIE_NAME, unlockToken(secret), {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}
