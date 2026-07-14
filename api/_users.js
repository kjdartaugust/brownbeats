/* Producer accounts.
 *
 * One JSON blob per user under data/users/, not one users.json that gets rewritten —
 * for the same reason as the catalogue: rewriting a shared file is read-modify-write, so
 * two people signing up in the same moment would both read the old list, both append,
 * and the second write would erase the first person's account.
 *
 * Passwords are never stored. Each is scrypt-hashed with its own random salt, which
 * matters especially here: the Blob store is public, so these files must be safe to read.
 * A salt per user also means two producers who pick the same password get different
 * hashes, and one cracked password does not reveal the other. */

import { list, put } from '@vercel/blob';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const DIR = 'data/users/';
const KEYLEN = 64;

export async function readUsers() {
  const { blobs } = await list({ prefix: DIR, limit: 1000 });

  const users = await Promise.all(
    blobs.map(async (b) => {
      try {
        const res = await fetch(b.url);
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    })
  );

  return users.filter(Boolean);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, KEYLEN);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored ?? '').split(':');
  if (!salt || !hash) return false;

  const key = await scrypt(password, salt, KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

const normalise = (email) => String(email ?? '').trim().toLowerCase();

export const findByEmail = (users, email) => users.find((u) => u.email === normalise(email));
export const findById = (users, id) => users.find((u) => u.id === id);

/* The admin is whoever signs up with ADMIN_EMAIL. Nothing in the signup form can grant
 * the role — it is decided here, from an environment variable only Vercel can set. */
export function roleFor(email) {
  const admin = normalise(process.env.ADMIN_EMAIL);
  return admin && normalise(email) === admin ? 'admin' : 'producer';
}

export async function createUser({ name, email, password }) {
  const cleanName = String(name ?? '').trim().slice(0, 60);
  const cleanEmail = normalise(email);

  if (!cleanName) throw new Error('Your name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('That email looks wrong.');
  if (String(password ?? '').length < 8) throw new Error('Use at least 8 characters.');

  if (findByEmail(await readUsers(), cleanEmail)) {
    throw new Error('That email already has an account.');
  }

  const user = {
    id: `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
    name: cleanName,
    email: cleanEmail,
    password: await hashPassword(password),
    role: roleFor(cleanEmail),
    createdAt: new Date().toISOString(),
  };

  await put(`${DIR}${user.id}.json`, JSON.stringify(user), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return user;
}

/* What may safely be sent to the browser: never the password hash. */
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
