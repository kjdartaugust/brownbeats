/* GET    /api/comments?beatId=        public — the thread
 * POST   /api/comments                signed in — { beatId, body }
 * DELETE /api/comments?beatId=&id=    the author, or an admin */

import { requireUser } from './_auth.js';
import { readComments, addComment, removeComment } from './_social.js';

/* The blobUrl is how the server finds the file to delete. It is not the browser's
 * business, and handing it out would let anyone read the raw record directly. */
const forBrowser = ({ blobUrl, ...c }) => c;

export default async function handler(req, res) {
  try {
    const beatId = String(req.query?.beatId ?? req.body?.beatId ?? '').trim();
    if (!beatId) return res.status(400).json({ error: 'Which beat?' });

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json((await readComments(beatId)).map(forBrowser));
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return;

      const comment = await addComment(beatId, user, req.body?.body);
      return res.status(201).json(comment);
    }

    if (req.method === 'DELETE') {
      const user = await requireUser(req, res);
      if (!user) return;

      const result = await removeComment(beatId, req.query?.id, user);
      if (result.error) return res.status(result.status).json({ error: result.error });

      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
