/* GET    /api/beats        public   — the store, with like and comment counts
 *                                     ?mine=1  the signed-in producer's own
 *                                     ?id=     a single beat, for its page
 * POST   /api/beats        producer — record a beat whose audio is already in Blob
 * DELETE /api/beats?id=    owner or admin */

import { requireUser, currentUser } from './_auth.js';
import { mayUpload } from './_users.js';
import { readCatalogue, addBeat, removeBeat, cleanBeat } from './_catalogue.js';
import { likeCounts, commentCounts, likedBy, purgeSocial } from './_social.js';

/* Counts come from two list() calls for the whole store, not one per beat. */
async function withCounts(beats, user) {
  const [likes, comments, mine] = await Promise.all([
    likeCounts(),
    commentCounts(),
    user ? likedBy(user.id) : Promise.resolve([]),
  ]);

  return beats.map((b) => ({
    ...b,
    likes: likes[b.id] ?? 0,
    comments: comments[b.id] ?? 0,
    likedByMe: mine.includes(b.id),
  }));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');

      const user = await currentUser(req);
      const beats = await readCatalogue();

      if (req.query?.id) {
        const beat = beats.find((b) => b.id === req.query.id);
        if (!beat) return res.status(404).json({ error: 'No such beat.' });
        const [withCount] = await withCounts([beat], user);
        return res.status(200).json(withCount);
      }

      if (req.query?.mine === '1') {
        if (!user) return res.status(401).json({ error: 'Sign in first.' });
        // An admin's dashboard is the whole catalogue; a producer's is their own.
        const own = user.role === 'admin' ? beats : beats.filter((b) => b.ownerId === user.id);
        return res.status(200).json(await withCounts(own, user));
      }

      return res.status(200).json(await withCounts(beats, user));
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return;

      // A listener account can like and comment, but it cannot publish.
      if (!mayUpload(user)) {
        return res.status(403).json({ error: 'Only producers can upload beats.' });
      }

      const { url, pathname, ...fields } = req.body ?? {};
      const beat = await addBeat(cleanBeat(fields, { url, pathname }, user));

      return res.status(201).json(beat);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res);
      if (!user) return;

      // Ownership is decided inside removeBeat, next to the data it checks.
      const result = await removeBeat(req.query?.id, user);
      if (result.error) return res.status(result.status).json({ error: result.error });

      // The likes and comments go with it, or they linger as orphans.
      await purgeSocial(req.query.id);

      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
