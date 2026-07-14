/* GET  /api/beats        public — the store reads this
 * POST /api/beats        admin  — record a beat whose audio is already in Blob
 * DELETE /api/beats?id=  admin  — remove a beat and its audio */

import { del } from '@vercel/blob';
import { requireAuth } from './_auth.js';
import { readCatalogue, writeCatalogue, cleanBeat } from './_catalogue.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // The catalogue changes whenever the producer uploads; never serve it stale.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await readCatalogue());
    }

    if (req.method === 'POST') {
      if (!requireAuth(req, res)) return;

      const { url, pathname, ...fields } = req.body ?? {};
      const beat = cleanBeat(fields, { url, pathname });

      const beats = await readCatalogue();
      beats.unshift(beat); // newest first
      await writeCatalogue(beats);

      return res.status(201).json(beat);
    }

    if (req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;

      const id = req.query?.id;
      const beats = await readCatalogue();
      const beat = beats.find((b) => b.id === id);
      if (!beat) return res.status(404).json({ error: 'No such beat.' });

      await writeCatalogue(beats.filter((b) => b.id !== id));

      // Drop the audio too, or the store bill grows with every deleted beat. Do this
      // after the manifest write: an orphaned file is cheaper than a dead link.
      if (beat.url) await del(beat.url).catch(() => {});

      return res.status(200).json({ deleted: id });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
