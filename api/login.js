import { checkPassword, issueCookie, clearCookie, isAuthed } from './_auth.js';

export default function handler(req, res) {
  // Lets the admin page tell whether the cookie it already holds is still good.
  if (req.method === 'GET') {
    return res.status(200).json({ authed: isAuthed(req) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ authed: false });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
  }

  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  res.setHeader('Set-Cookie', issueCookie());
  return res.status(200).json({ authed: true });
}
