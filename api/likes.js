/* POST /api/likes  { beatId }  — toggle. Any signed-in account, listener included.
 *
 * There is no anonymous like: a like has to mean one person, and without an account it
 * means one click. The uniqueness is enforced by the blob's pathname, not by counting
 * here, so a double-tap or a replayed request cannot inflate the total. */

import { requireUser } from './_auth.js';
import { toggleLike, likeCounts } from './_social.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const beatId = String(req.body?.beatId ?? '').trim();
  if (!beatId) return res.status(400).json({ error: 'Which beat?' });

  const { liked } = await toggleLike(beatId, user.id);
  const counts = await likeCounts();

  return res.status(200).json({ liked, likes: counts[beatId] ?? 0 });
}
