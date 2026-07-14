/* GET    /api/producers        admin — every account, with how many beats each has
 * DELETE /api/producers?id=    admin — remove an account and everything it posted */

import { requireAdmin } from './_auth.js';
import { readUsers, publicUser, removeUser, findById } from './_users.js';
import { readCatalogue, removeBeatsByOwner } from './_catalogue.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const [users, beats] = await Promise.all([readUsers(), readCatalogue()]);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(
      users.map((u) => ({
        ...publicUser(u), // never the password hash, not even to an admin
        createdAt: u.createdAt,
        beats: beats.filter((b) => b.ownerId === u.id).length,
      }))
    );
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;

    // Removing yourself would lock the only admin out of the panel for good.
    if (id === admin.id) return res.status(400).json({ error: 'You cannot remove yourself.' });

    const user = findById(await readUsers(), id);
    if (!user) return res.status(404).json({ error: 'No such producer.' });

    const beats = await removeBeatsByOwner(id);
    await removeUser(id);

    return res.status(200).json({ deleted: id, beatsRemoved: beats });
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
