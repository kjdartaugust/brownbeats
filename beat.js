/* One beat: play it, like it, talk about it. */

import { me, wireSignOut, money } from './manage.js';
import { createPlayer } from './player.js';
import { toast } from './ui.js';

const id = new URLSearchParams(location.search).get('id') ?? location.pathname.split('/').pop();

const el = (x) => document.getElementById(x);
const user = await me();

/* Nav reflects whether anyone is signed in. */
if (user) {
  el('joinLink').hidden = true;
  el('who').hidden = false;
  el('who').textContent = user.name;
  el('signOut').hidden = false;
  wireSignOut(el('signOut'));
}

const res = await fetch(`/api/beats?id=${encodeURIComponent(id)}`);
if (!res.ok) {
  el('missing').hidden = false;
} else {
  const beat = await res.json();
  render(beat);
  loadComments();
}

function render(beat) {
  el('beat').hidden = false;
  document.title = `${beat.title} — BROWNBEATS`;

  el('beatType').textContent = beat.type === 'sample' ? 'Sample' : 'Beat';
  el('beatTitle').textContent = beat.title;
  el('beatMeta').textContent = [beat.ownerName, beat.genre, beat.bpm && `${beat.bpm} BPM`, beat.key]
    .filter(Boolean)
    .join(' · ');

  el('beatNotes').textContent = beat.notes ?? '';
  el('beatNotes').hidden = !beat.notes;

  el('player').replaceWith(createPlayer(beat.url));
  el('beatPrice').textContent = money(beat.price);

  // The buy flow lives on the home page's booking form; carry the beat over to it.
  el('buyBtn').href = `/?buy=${encodeURIComponent(beat.id)}#contact`;

  paintLike(beat.likes, beat.likedByMe);
  el('commentCount').textContent = beat.comments ? `${beat.comments}` : '';

  // Only a signed-in person can like or comment — a like has to mean one person.
  el('commentForm').hidden = !user;
  el('signInToTalk').hidden = !!user;
}

function paintLike(count, liked) {
  el('likeCount').textContent = count;
  el('heart').textContent = liked ? '♥' : '♡';
  el('likeBtn').classList.toggle('liked', !!liked);
}

el('likeBtn').addEventListener('click', async () => {
  if (!user) return location.assign('/join');

  el('likeBtn').disabled = true;
  const res = await fetch('/api/likes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: id }),
  });

  if (res.ok) {
    const { liked, likes } = await res.json();
    paintLike(likes, liked);
  }
  el('likeBtn').disabled = false;
});

/* ---------- comments ---------- */

async function loadComments() {
  const list = await fetch(`/api/comments?beatId=${encodeURIComponent(id)}`)
    .then((r) => r.json())
    .catch(() => []);

  const box = el('comments');
  box.innerHTML = '';
  el('commentCount').textContent = list.length ? `${list.length}` : '';

  if (!list.length) {
    box.innerHTML = '<p class="form-note">No comments yet.</p>';
    return;
  }

  list.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'admin-row comment';

    const meta = document.createElement('div');
    meta.className = 'admin-meta';

    const who = document.createElement('strong');
    who.textContent = c.authorName; // textContent: this is someone else's text

    const body = document.createElement('span');
    body.className = 'comment-body';
    body.textContent = c.body;

    meta.append(who, body);
    row.append(meta);

    // The author may delete their own; an admin may delete anything. The server checks
    // this again — hiding the button is presentation, not permission.
    if (user && (user.role === 'admin' || user.id === c.authorId)) {
      const remove = document.createElement('button');
      remove.className = 'btn danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        const res = await fetch(
          `/api/comments?beatId=${encodeURIComponent(id)}&id=${encodeURIComponent(c.id)}`,
          { method: 'DELETE' }
        );
        if (res.ok) loadComments();
        else {
          remove.disabled = false;
          remove.textContent = 'Failed';
        }
      });
      row.append(remove);
    }

    box.appendChild(row);
  });
}

el('commentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const note = el('commentNote');

  note.textContent = 'Posting…';
  const res = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: id, body: form.body.value }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    note.textContent = error ?? 'Could not post that.';
    return;
  }

  form.reset();
  note.textContent = '';
  loadComments();
});
