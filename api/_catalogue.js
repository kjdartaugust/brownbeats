/* The beat catalogue.
 *
 * Each beat is its own small JSON blob under data/beats/, and the catalogue is the
 * directory listing. It is emphatically NOT one beats.json that gets rewritten, which is
 * what this used to be, for two reasons that both bite once more than one producer
 * exists:
 *
 *   Lost updates. Rewriting a shared file means read-modify-write. Two producers
 *   uploading at the same moment both read the old list, both append, and whoever writes
 *   second silently erases the other's beat.
 *
 *   Stale reads. Blob serves overwritten files from a CDN, and the old copy kept coming
 *   back for ~20 seconds after a write — long enough for a producer to upload, not see
 *   their beat, and upload it again.
 *
 * Writing a new file per beat sidesteps both: nothing is ever overwritten, so there is
 * nothing to clobber and nothing stale to serve. Deleting is del(). The listing itself
 * comes from the Blob API rather than the CDN, so it is read-after-write consistent.
 *
 * The audio is uploaded browser -> Blob directly and never passes through a function: a
 * serverless request body caps at 4.5 MB and a beat is larger than that. */

import { list, put, del } from '@vercel/blob';

const DIR = 'data/beats/';

/* Every beat, newest first, each paired with the URL of its own entry file so it can be
 * deleted later. */
async function readEntries() {
  const { blobs } = await list({ prefix: DIR, limit: 1000 });

  const entries = await Promise.all(
    blobs.map(async (b) => {
      try {
        // Entry files are immutable, so this is safe to serve from cache.
        const res = await fetch(b.url);
        if (!res.ok) return null;
        return { beat: await res.json(), entryUrl: b.url };
      } catch {
        return null;
      }
    })
  );

  return entries
    .filter(Boolean)
    .sort((a, b) => String(b.beat.addedAt).localeCompare(String(a.beat.addedAt)));
}

export async function readCatalogue() {
  return (await readEntries()).map((e) => e.beat);
}

export async function addBeat(beat) {
  await put(`${DIR}${beat.id}.json`, JSON.stringify(beat), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false, // the id is already unique; keep the path predictable
  });
  return beat;
}

/* Removes the beat and the audio it points at. */
export async function removeBeat(id, user) {
  const entry = (await readEntries()).find((e) => e.beat.id === id);
  if (!entry) return { error: 'No such beat.', status: 404 };

  // A producer owns their beats; an admin may remove anything. Enforced here, on the
  // server — a dashboard that simply does not draw the button is not a control.
  if (!(user.role === 'admin' || entry.beat.ownerId === user.id)) {
    return { error: 'Not your beat.', status: 403 };
  }

  await del(entry.entryUrl);
  if (entry.beat.url) await del(entry.beat.url).catch(() => {}); // orphan < dead link

  return { deleted: id };
}

/* Never trust what the upload form posts: it reaches the public store. The owner comes
 * from the session, never from the request body — otherwise a producer could publish a
 * beat under someone else's name. */
export function cleanBeat(input, { url, pathname }, owner) {
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
    ownerId: owner.id,
    ownerName: owner.name,
    addedAt: new Date().toISOString(),
  };
}
