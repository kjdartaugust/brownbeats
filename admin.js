/* Admin page: sign in, upload a beat, remove one.
 *
 * The audio goes browser -> Blob directly (a function body caps at 4.5 MB), so this is
 * the one page that pulls in a dependency. The public site stays dependency-free. */

import { upload } from 'https://esm.sh/@vercel/blob@1.1.1/client';

const gate = document.getElementById('gate');
const panel = document.getElementById('panel');
const signOut = document.getElementById('signOut');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const loginNote = document.getElementById('loginNote');
const uploadNote = document.getElementById('uploadNote');

const money = (n) => (typeof n === 'number' ? `₵${n.toLocaleString()}` : '—');

function show(authed) {
  gate.hidden = authed;
  panel.hidden = !authed;
  signOut.hidden = !authed;
  if (authed) refresh();
}

/* ---------- session ---------- */

const authed = await fetch('/api/login')
  .then((r) => r.json())
  .then((d) => d.authed)
  .catch(() => false);
show(authed);

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginNote.textContent = 'Checking…';

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: e.target.password.value }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    loginNote.textContent = error ?? 'Could not sign in.';
    return;
  }

  e.target.reset();
  loginNote.textContent = '';
  show(true);
});

signOut.addEventListener('click', async () => {
  await fetch('/api/login', { method: 'DELETE' });
  show(false);
});

/* ---------- the list ---------- */

async function refresh() {
  const beats = await fetch('/api/beats').then((r) => r.json()).catch(() => []);
  countEl.textContent = beats.length ? `${beats.length} live` : '';
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
    const bits = [b.type === 'sample' ? 'Sample' : 'Beat', b.genre, b.bpm && `${b.bpm} BPM`, b.key]
      .filter(Boolean)
      .join(' · ');
    meta.innerHTML = `<strong></strong><span></span>`;
    meta.querySelector('strong').textContent = b.title;
    meta.querySelector('span').textContent = `${bits} — ${money(b.price)}`;

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = b.url;

    const remove = document.createElement('button');
    remove.className = 'btn danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      // No confirm() — a modal dialog would block the page.
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
      if (res.ok) refresh();
      else {
        remove.disabled = false;
        remove.textContent = 'Remove failed';
      }
    });

    row.append(meta, audio, remove);
    listEl.appendChild(row);
  });
}

/* ---------- upload ---------- */

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const file = form.file.files[0];
  if (!file) return;

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    uploadNote.textContent = 'Uploading… 0%';

    // Straight to Blob. /api/blob-upload only mints the token, and only for an admin.
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      onUploadProgress: ({ percentage }) => {
        uploadNote.textContent = `Uploading… ${Math.round(percentage)}%`;
      },
    });

    uploadNote.textContent = 'Saving…';

    const body = {
      url: blob.url,
      pathname: blob.pathname,
      title: form.title.value,
      type: form.type.value,
      genre: form.genre.value,
      bpm: form.bpm.value,
      key: form.key.value,
      price: form.price.value,
      notes: form.notes.value,
    };

    const res = await fetch('/api/beats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error ?? 'Could not save the beat.');
    }

    form.reset();
    uploadNote.textContent = 'Live on the store.';
    refresh();
  } catch (err) {
    uploadNote.textContent = err.message ?? 'Upload failed.';
  } finally {
    button.disabled = false;
  }
});
