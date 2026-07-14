/* GET    /api/beats        public  — the store. ?mine=1 for the signed-in producer's own
 * POST   /api/beats        producer— record a beat whose audio is already in Blob
 * DELETE /api/beats?id=    owner or admin */

import { requireUser, currentUser } from './_auth.js';
import { readCatalogue, addBeat, removeBeat, cleanBeat } from './_catalogue.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const beats = await readCatalogue();

      if (req.query?.mine === '1') {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: 'Sign in first.' });
        // An admin's dashboard is the whole catalogue; a producer's is their own.
        return res
          .status(200)
          .json(user.role === 'admin' ? beats : beats.filter((b) => b.ownerId === user.id));
      }

      return res.status(200).json(beats);
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return;

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

      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
