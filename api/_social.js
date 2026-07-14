/* Likes and comments.
 *
 * Both are one immutable blob per record, for the same reasons as beats and users: no
 * shared file to clobber when two people act at once, and nothing overwritten for the
 * CDN to serve stale.
 *
 * The pathname carries the identifiers:
 *
 *   data/likes/<beatId>__<userId>.json
 *   data/comments/<beatId>/<commentId>.json
 *
 * That is deliberate. Counting likes and comments for the whole store is then a single
 * list() and some string splitting — no fetch per record. Otherwise showing counts on a
 * store of 50 beats would mean hundreds of HTTP requests on every page load.
 *
 * A like's path is also its uniqueness constraint: liking twice writes the same
 * pathname, so a double-tap cannot inflate the count. */

import { list, put, del } from '@vercel/blob';

const LIKES = 'data/likes/';
const COMMENTS = 'data/comments/';

const likePath = (beatId, userId) => `${LIKES}${beatId}__${userId}.json`;

/* ---------- likes ---------- */

async function allLikes() {
  const { blobs } = await list({ prefix: LIKES, limit: 1000 });

  return blobs
    .map((b) => {
      const name = b.pathname.slice(LIKES.length).replace(/\.json$/, '');
      const [beatId, userId] = name.split('__');
      return beatId && userId ? { beatId, userId, url: b.url } : null;
    })
    .filter(Boolean);
}

/* beatId -> number of likes, for the whole store in one call. */
export async function likeCounts() {
  const counts = {};
  for (const like of await allLikes()) {
    counts[like.beatId] = (counts[like.beatId] ?? 0) + 1;
  }
  return counts;
}

/* Which beats this user has liked, so the heart can render filled. */
export async function likedBy(userId) {
  return (await allLikes()).filter((l) => l.userId === userId).map((l) => l.beatId);
}

export async function toggleLike(beatId, userId) {
  const existing = (await allLikes()).find((l) => l.beatId === beatId && l.userId === userId);

  if (existing) {
    await del(existing.url);
    return { liked: false };
  }

  await put(likePath(beatId, userId), JSON.stringify({ beatId, userId, at: new Date().toISOString() }), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false, // the path IS the constraint: one like per person per beat
    allowOverwrite: true,
  });

  return { liked: true };
}

/* ---------- comments ---------- */

export async function commentCounts() {
  const { blobs } = await list({ prefix: COMMENTS, limit: 1000 });

  const counts = {};
  for (const b of blobs) {
    const beatId = b.pathname.slice(COMMENTS.length).split('/')[0];
    if (beatId) counts[beatId] = (counts[beatId] ?? 0) + 1;
  }
  return counts;
}

/* Oldest first — a thread reads top to bottom. */
export async function readComments(beatId) {
  const { blobs } = await list({ prefix: `${COMMENTS}${beatId}/`, limit: 1000 });

  const comments = await Promise.all(
    blobs.map(async (b) => {
      try {
        const res = await fetch(b.url);
        if (!res.ok) return null;
        return { ...(await res.json()), blobUrl: b.url };
      } catch {
        return null;
      }
    })
  );

  return comments
    .filter(Boolean)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export async function addComment(beatId, user, body) {
  const text = String(body ?? '').trim().slice(0, 600);
  if (!text) throw new Error('Say something first.');

  const comment = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    beatId,
    body: text,
    authorId: user.id,
    authorName: user.name, // from the session, never the request body
    at: new Date().toISOString(),
  };

  await put(`${COMMENTS}${beatId}/${comment.id}.json`, JSON.stringify(comment), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return comment;
}

/* The author may delete their own; an admin may delete anything. */
export async function removeComment(beatId, id, user) {
  const comment = (await readComments(beatId)).find((c) => c.id === id);
  if (!comment) return { error: 'No such comment.', status: 404 };

  if (!(user.role === 'admin' || comment.authorId === user.id)) {
    return { error: 'Not your comment.', status: 403 };
  }

  await del(comment.blobUrl);
  return { deleted: id };
}

/* When a beat goes, its likes and comments go with it — otherwise they linger as
 * orphans, and a future beat that happened to reuse the id would inherit them. */
export async function purgeSocial(beatId) {
  const [likes, { blobs: comments }] = await Promise.all([
    allLikes(),
    list({ prefix: `${COMMENTS}${beatId}/`, limit: 1000 }),
  ]);

  const urls = [
    ...likes.filter((l) => l.beatId === beatId).map((l) => l.url),
    ...comments.map((b) => b.url),
  ];

  await Promise.all(urls.map((u) => del(u).catch(() => {})));
}
