/* GET /api/producers — admin only. Every account, with how many beats each has posted. */

import { requireAdmin } from './_auth.js';
import { readUsers, publicUser } from './_users.js';
import { readCatalogue } from './_catalogue.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const [users, beats] = await Promise.all([readUsers(), readCatalogue()]);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(
    users.map((u) => ({
      ...publicUser(u), // never the password hash, even to an admin
      createdAt: u.createdAt,
      beats: beats.filter((b) => b.ownerId === u.id).length,
    }))
  );
}
