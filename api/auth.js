/* GET    /api/auth   — who am I (or null)
 * POST   /api/auth   — { action: 'signup' | 'signin', ... }
 * DELETE /api/auth   — sign out */

import { issueCookie, clearCookie, currentUser } from './_auth.js';
import { readUsers, findByEmail, verifyPassword, createUser, publicUser } from './_users.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const user = await currentUser(req);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ user: user ? publicUser(user) : null });
    }

    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ user: null });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const { action, name, email, password, role } = req.body ?? {};

    if (action === 'signup') {
      const user = await createUser({ name, email, password, role });
      res.setHeader('Set-Cookie', issueCookie(user));
      return res.status(201).json({ user: publicUser(user) });
    }

    if (action === 'signin') {
      const user = findByEmail(await readUsers(), email);

      // Verify even when there is no such user, so the response time does not reveal
      // which emails have accounts.
      const stored = user?.password ?? 'x:00';
      const ok = await verifyPassword(String(password ?? ''), stored);

      if (!user || !ok) return res.status(401).json({ error: 'Wrong email or password.' });

      res.setHeader('Set-Cookie', issueCookie(user));
      return res.status(200).json({ user: publicUser(user) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(400).json({ error: err.message ?? 'Something went wrong.' });
  }
}
