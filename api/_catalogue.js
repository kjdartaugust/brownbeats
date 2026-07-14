/* The beat catalogue.
 *
 * There is no database. The catalogue is one JSON file in Blob storage, rewritten
 * whenever a beat is added or removed — which is fine because there is exactly one
 * writer (the producer) and the file is a few kilobytes.
 *
 * The audio itself is uploaded straight from the browser to Blob, so the audio never
 * passes through a function: a serverless request body caps out at 4.5 MB and a beat
 * is comfortably larger than that. */

import { list, put } from '@vercel/blob';

const MANIFEST = 'data/beats.json';

export async function readCatalogue() {
  const { blobs } = await list({ prefix: MANIFEST, limit: 1 });
  if (!blobs.length) return [];

  // Blob is a CDN and will happily serve a stale manifest right after a write.
  const res = await fetch(`${blobs[0].url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];

  try {
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function writeCatalogue(beats) {
  await put(MANIFEST, JSON.stringify(beats, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false, // stable path, so it can be found and overwritten
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/* Never trust what the admin form posts: it reaches the public catalogue. */
export function cleanBeat(input, { url, pathname }) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };

  const title = str(input.title, 80);
  if (!title) throw new Error('A title is required.');
  if (!url) throw new Error('An uploaded audio file is required.');

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    type: input.type === 'sample' ? 'sample' : 'beat',
    genre: str(input.genre, 40),
    bpm: num(input.bpm),
    key: str(input.key, 12),
    price: num(input.price),
    notes: str(input.notes, 300),
    url,
    pathname,
    addedAt: new Date().toISOString(),
  };
}
