/* Producer accounts.
 *
 * Like the catalogue, this is one JSON file in Blob rather than a database. That is a
 * deliberate trade for a site this size, and it has one real limit: two people signing
 * up in the same instant can clobber each other, because the file is read and rewritten
 * whole. Signups are rare enough that this is acceptable; if it stops being true, this
 * is the module to move onto Postgres, and nothing else has to change.
 *
 * Passwords are never stored. Each one is scrypt-hashed with its own random salt, so a
 * dump of this file does not hand over anybody's password, and two producers who happen
 * to choose the same password get different hashes. */

import { list, put } from '@vercel/blob';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const USERS = 'data/users.json';
const KEYLEN = 64;

export async function readUsers() {
  const { blobs } = await list({ prefix: USERS, limit: 1 });
  if (!blobs.length) return [];

  const res = await fetch(`${blobs[0].url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];

  try {
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await put(USERS, JSON.stringify(users, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/* The file is public (the Blob store is), so it must never hold anything that is
 * dangerous to read. Hashes and salts are safe; a plaintext password would not be. */
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

export const findByEmail = (users, email) =>
  users.find((u) => u.email === normalise(email));

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

  const users = await readUsers();
  if (findByEmail(users, cleanEmail)) throw new Error('That email already has an account.');

  const user = {
    id: `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
    name: cleanName,
    email: cleanEmail,
    password: await hashPassword(password),
    role: roleFor(cleanEmail),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  await writeUsers(users);
  return user;
}

/* What may safely be sent to the browser. */
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
