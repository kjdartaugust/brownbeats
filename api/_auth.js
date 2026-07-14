/* Sessions.
 *
 * A session is a signed cookie, not a server-side record: there is nowhere cheap to
 * keep one, and a signed cookie is enough to answer "who is this and what may they do".
 * The cookie carries the user id and role, and an HMAC over both — so a producer cannot
 * simply edit `role=admin` into their own cookie without also forging the signature,
 * which needs the server's key.
 *
 * The role is still re-read from the user record on every write. The cookie says who
 * you claim to be; the stored user says what you are. */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readUsers, findById } from './_users.js';

const COOKIE = 'bb_session';
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function signingKey() {
  const key = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;
  if (!key) throw new Error('ADMIN_SECRET is not configured on the server.');
  return key;
}

const sign = (data) => createHmac('sha256', signingKey()).update(data).digest('base64url');

function constantTimeEqual(a, b) {
  const ha = createHmac('sha256', 'cmp').update(String(a)).digest();
  const hb = createHmac('sha256', 'cmp').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function issueCookie(user) {
  const expires = Date.now() + TTL_MS;
  const nonce = randomBytes(6).toString('base64url');
  const payload = `${user.id}.${expires}.${nonce}`;
  const token = `${payload}.${sign(payload)}`;

  return [
    `${COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ].join('; ');
}

export const clearCookie = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

/* Returns the user id the cookie claims, or null. Verifies the signature and expiry
 * but does not touch storage. */
function claimedId(req) {
  const raw = req.headers?.cookie ?? '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;

  const parts = match.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 4) return null;

  const [id, expires, nonce, mac] = parts;
  const payload = `${id}.${expires}.${nonce}`;

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }

  if (!constantTimeEqual(mac, expected)) return null;
  if (!(Number(expires) > Date.now())) return null;
  return id;
}

/* The signed-in user, read fresh from storage — so a deleted account or a changed role
 * takes effect immediately rather than whenever the cookie happens to expire. */
export async function currentUser(req) {
  const id = claimedId(req);
  if (!id) return null;
  return findById(await readUsers(), id) ?? null;
}

/* Guards. Each returns the user, or null having already answered the request. */

export async function requireUser(req, res) {
  const user = await currentUser(req);
  if (user) return user;
  res.status(401).json({ error: 'Sign in first.' });
  return null;
}

export async function requireAdmin(req, res) {
  const user = await currentUser(req);
  if (user?.role === 'admin') return user;
  // Same answer either way: do not tell a stranger whether admin exists.
  res.status(403).json({ error: 'Not allowed.' });
  return null;
}
