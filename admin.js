/* Admin panel: every producer, every beat.
 *
 * Hiding this page from a non-admin is a courtesy, not a control — the API refuses them
 * regardless, which is where the actual boundary lives. */

import { requireSession, wireSignOut, renderBeats } from './manage.js';

const user = await requireSession();

if (user && user.role !== 'admin') {
  document.getElementById('denied').hidden = false;
} else if (user) {
  document.getElementById('main').hidden = false;
  document.getElementById('who').textContent = user.name;
  wireSignOut(document.getElementById('signOut'));

  const listEl = document.getElementById('list');
  const producersEl = document.getElementById('producers');

  async function refresh() {
    const [beats, producers] = await Promise.all([
      fetch('/api/beats').then((r) => r.json()).catch(() => []),
      fetch('/api/producers').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);

    document.getElementById('beatCount').textContent = beats.length ? `${beats.length} live` : '';
    document.getElementById('producerCount').textContent =
      producers.length ? `${producers.length} signed up` : '';

    renderBeats(listEl, beats, { showOwner: true, onRemoved: refresh });

    producersEl.innerHTML = '';
    if (!producers.length) {
      producersEl.innerHTML = '<p class="form-note">Nobody has signed up yet.</p>';
      return;
    }

    producers.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'admin-row';

      const meta = document.createElement('div');
      meta.className = 'admin-meta';

      const name = document.createElement('strong');
      name.textContent = p.role === 'admin' ? `${p.name} (admin)` : p.name;

      const sub = document.createElement('span');
      sub.textContent = `${p.email} — ${p.beats} beat${p.beats === 1 ? '' : 's'}`;

      meta.append(name, sub);
      row.append(meta);
      producersEl.appendChild(row);
    });
  }

  refresh();
}
