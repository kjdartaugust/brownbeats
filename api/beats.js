/* GET    /api/beats        public  — the store. ?mine=1 for the signed-in producer's own
 * POST   /api/beats        producer— record a beat whose audio is already in Blob
 * DELETE /api/beats?id=    owner or admin */

import { del } from '@vercel/blob';
import { requireUser, currentUser } from './_auth.js';
import { readCatalogue, writeCatalogue, cleanBeat, mayDelete } from './_catalogue.js';

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
      const beat = cleanBeat(fields, { url, pathname }, user);

      const beats = await readCatalogue();
      beats.unshift(beat); // newest first
      await writeCatalogue(beats);

      return res.status(201).json(beat);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res);
      if (!user) return;

      const beats = await readCatalogue();
      const beat = beats.find((b) => b.id === req.query?.id);
      if (!beat) return res.status(404).json({ error: 'No such beat.' });

      // A producer may only remove their own. Checked here, on the server, because the
      // dashboard simply not drawing the button is not a control.
      if (!mayDelete(beat, user)) return res.status(403).json({ error: 'Not your beat.' });

      await writeCatalogue(beats.filter((b) => b.id !== beat.id));

      // Drop the audio too, or storage grows with every deleted beat. After the manifest
      // write: an orphaned file is cheaper than a dead link.
      if (beat.url) await del(beat.url).catch(() => {});

      return res.status(200).json({ deleted: beat.id });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
