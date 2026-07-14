/* Admin auth.
 *
 * There is one admin (the producer), so there is no user table and no sessions to
 * store: logging in mints a signed, expiring cookie and every write route verifies it.
 *
 * The password itself is never stored anywhere in this repo — it lives in the
 * ADMIN_PASSWORD environment variable on Vercel. */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'bb_admin';
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/* Signing key. Falls back to the password so the app still works if only
 * ADMIN_PASSWORD is set, but a separate ADMIN_SECRET is better: rotating one then
 * does not invalidate the other. */
function signingKey() {
  const key = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;
  if (!key) throw new Error('ADMIN_PASSWORD is not configured');
  return key;
}

const sign = (data) => createHmac('sha256', signingKey()).update(data).digest('base64url');

/* Compare in constant time. Both sides are hashed first so that timingSafeEqual never
 * sees mismatched lengths (it throws) and so the comparison cannot leak the length of
 * the real password. */
function constantTimeEqual(a, b) {
  const ha = createHmac('sha256', 'cmp').update(String(a)).digest();
  const hb = createHmac('sha256', 'cmp').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(candidate) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  return constantTimeEqual(candidate ?? '', real);
}

export function issueCookie() {
  const expires = Date.now() + TTL_MS;
  const nonce = randomBytes(8).toString('base64url');
  const payload = `${expires}.${nonce}`;
  const token = `${payload}.${sign(payload)}`;

  return [
    `${COOKIE}=${token}`,
    'HttpOnly',                    // not readable from JS, so an XSS cannot steal it
    'Secure',
    'SameSite=Strict',             // not sent on cross-site requests, so no CSRF on writes
    'Path=/',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ].join('; ');
}

export const clearCookie = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export function isAuthed(req) {
  const raw = req.headers?.cookie ?? '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return false;

  const token = match.slice(COOKIE.length + 1);
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expires, nonce, mac] = parts;
  const payload = `${expires}.${nonce}`;

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return false; // no key configured
  }

  if (!constantTimeEqual(mac, expected)) return false;
  return Number(expires) > Date.now();
}

/* Guard for the write routes. Returns true when the request may proceed. */
export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: 'Not signed in.' });
  return false;
}
