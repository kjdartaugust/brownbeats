/* A producer's own catalogue: upload, and manage what they have posted.
 *
 * The audio goes browser -> Blob directly (a function body caps at 4.5 MB), which is why
 * this page pulls in the Blob client. The public site stays dependency-free. */

import { upload } from 'https://esm.sh/@vercel/blob@1.1.1/client';
import { requireSession, wireSignOut, renderBeats } from './manage.js';
import { toast } from './ui.js';

const user = await requireSession();

/* A listener has no catalogue. The API refuses their uploads anyway; this just avoids
 * showing them a form that can only fail. */
if (user && user.role === 'listener') {
  location.replace('/#beats');
} else if (user) {
  document.getElementById('who').textContent = user.name;
  document.getElementById('adminLink').hidden = user.role !== 'admin';
  wireSignOut(document.getElementById('signOut'));

  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const uploadNote = document.getElementById('uploadNote');

  const refresh = async () => {
    // ?mine=1 — the server decides what "mine" means, and hands an admin everything.
    const beats = await fetch('/api/beats?mine=1').then((r) => r.json()).catch(() => []);
    countEl.textContent = beats.length ? `${beats.length} live` : '';
    renderBeats(listEl, beats, { showOwner: user.role === 'admin', onRemoved: refresh });
  };

  refresh();

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const file = form.file.files[0];
    if (!file) return;

    const button = form.querySelector('button[type="submit"]');
    const bar = document.getElementById('uploadBar');
    const fill = document.getElementById('uploadFill');

    button.disabled = true;
    button.textContent = 'Uploading…';
    bar.hidden = false;
    fill.style.width = '0%';

    // A beat is tens of megabytes on a phone connection: a percentage that moves is the
    // difference between waiting and assuming it has hung.
    const progress = toast('Uploading… 0%', 'busy', { sticky: true });

    try {
      // Straight to Blob. /api/blob-upload only mints the token, and only for a producer.
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
        onUploadProgress: ({ percentage }) => {
          const pct = Math.round(percentage);
          fill.style.width = `${pct}%`;
          progress.update(`Uploading… ${pct}%`, 'busy');
        },
      });

      progress.update('Saving…', 'busy');

      const res = await fetch('/api/beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: blob.url,
          pathname: blob.pathname,
          title: form.title.value,
          type: form.type.value,
          genre: form.genre.value,
          bpm: form.bpm.value,
          key: form.key.value,
          price: form.price.value,
          notes: form.notes.value,
        }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        throw new Error(error ?? 'Could not save the beat.');
      }

      form.reset();
      progress.dismiss();
      toast(`"${blob.pathname.split('/').pop()}" is live on the store.`, 'ok');
      uploadNote.textContent = '';
      refresh();
    } catch (err) {
      progress.dismiss();
      toast(err.message ?? 'Upload failed.', 'bad');
      uploadNote.textContent = err.message ?? 'Upload failed.';
    } finally {
      button.disabled = false;
      button.textContent = 'Upload';
      bar.hidden = true;
    }
  });
}
