/* Shared by the producer dashboard and the admin panel: the signed-in user, and the
 * list of beat rows with a remove button. */

import { createPlayer } from './player.js';

export const money = (n) => (typeof n === 'number' && n > 0 ? `₵${n.toLocaleString()}` : '—');

export async function me() {
  try {
    const { user } = await (await fetch('/api/auth')).json();
    return user;
  } catch {
    return null;
  }
}

/* Sends anyone who is not signed in to the join page, and returns the user otherwise. */
export async function requireSession() {
  const user = await me();
  if (!user) {
    location.replace('/join');
    return null;
  }
  return user;
}

export function wireSignOut(button) {
  button?.addEventListener('click', async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    location.href = '/';
  });
}

/* One row per beat. `showOwner` is on for the admin, who is looking at everyone's. */
export function renderBeats(listEl, beats, { showOwner = false, onRemoved } = {}) {
  listEl.innerHTML = '';

  if (!beats.length) {
    listEl.innerHTML = '<p class="form-note">Nothing uploaded yet.</p>';
    return;
  }

  beats.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'admin-row';

    const meta = document.createElement('div');
    meta.className = 'admin-meta';

    const title = document.createElement('strong');
    title.textContent = b.title; // textContent: this came from a form

    const sub = document.createElement('span');
    const bits = [
      b.type === 'sample' ? 'Sample' : 'Beat',
      showOwner && b.ownerName,
      b.genre,
      b.bpm && `${b.bpm} BPM`,
      b.key,
    ].filter(Boolean);
    sub.textContent = `${bits.join(' · ')} — ${money(b.price)}`;

    meta.append(title, sub);

    const audio = createPlayer(b.url, { compact: true });

    const remove = document.createElement('button');
    remove.className = 'btn danger';
    remove.textContent = 'Remove';

    remove.addEventListener('click', async () => {
      // Two taps rather than confirm(): a modal dialog blocks the page.
      if (remove.dataset.armed !== 'yes') {
        remove.dataset.armed = 'yes';
        remove.textContent = 'Tap again to remove';
        setTimeout(() => {
          remove.dataset.armed = 'no';
          remove.textContent = 'Remove';
        }, 4000);
        return;
      }

      remove.disabled = true;
      remove.textContent = 'Removing…';

      const res = await fetch(`/api/beats?id=${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      if (res.ok) onRemoved?.();
      else {
        remove.disabled = false;
        const { error } = await res.json().catch(() => ({}));
        remove.textContent = error ?? 'Remove failed';
      }
    });

    row.append(meta, audio, remove);
    listEl.appendChild(row);
  });
}
