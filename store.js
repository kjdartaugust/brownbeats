/* The beat store: search, filter, sort, play, and enquire. */

import { createPlayer } from './player.js';
import { toast, skeleton } from './ui.js';

const box = document.getElementById('beatStore');
const money = (n) => (typeof n === 'number' && n > 0 ? `₵${n.toLocaleString()}` : 'Ask');

let all = [];

/* ---------- the nav knows who you are ---------- */

fetch('/api/auth')
  .then((r) => r.json())
  .then(({ user }) => {
    const link = document.getElementById('joinLink');
    if (!link) return;

    if (!user) return; // stays "Producers"
    link.textContent = user.role === 'listener' ? user.name : 'Your beats';
    link.href = user.role === 'listener' ? '/join' : '/dashboard';
  })
  .catch(() => {});

/* ---------- buying ---------- */

/* Fills the booking form rather than opening a mail client: it keeps the visitor on the
 * page, and every enquiry lands in the same inbox. */
function enquire(beat) {
  const form = document.getElementById('contactForm');
  form.service.value = 'Something else';
  if (beat.price) form.budget.value = `₵${beat.price.toLocaleString()}`;

  const label = beat.type === 'sample' ? 'sample' : 'beat';
  form.message.value =
    `I want to buy the ${label} "${beat.title}"` +
    `${beat.ownerName ? ` by ${beat.ownerName}` : ''}` +
    `${beat.bpm ? ` (${beat.bpm} BPM${beat.key ? `, ${beat.key}` : ''})` : ''}.\n\n`;

  document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
  form.message.focus();
  toast(`Enquiring about "${beat.title}" — add your details and send.`);
}

/* ---------- a card ---------- */

function card(beat) {
  const el = document.createElement('article');
  el.className = 'card beat';

  const top = document.createElement('div');
  top.className = 'beat-top';

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = beat.type === 'sample' ? 'Sample' : 'Beat';

  const social = document.createElement('a');
  social.className = 'beat-social';
  social.href = `/beat/${encodeURIComponent(beat.id)}`;
  social.innerHTML = `<span>${beat.likedByMe ? '♥' : '♡'} ${beat.likes ?? 0}</span>` +
                     `<span>💬 ${beat.comments ?? 0}</span>`;
  social.title = 'Open this beat';

  top.append(tag, social);

  const title = document.createElement('a');
  title.className = 'beat-title';
  title.href = `/beat/${encodeURIComponent(beat.id)}`;
  title.textContent = beat.title; // textContent: this came from a form

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = [beat.ownerName, beat.genre, beat.bpm && `${beat.bpm} BPM`, beat.key]
    .filter(Boolean)
    .join(' · ');

  el.append(top, title, meta);

  if (beat.notes) {
    const notes = document.createElement('p');
    notes.className = 'beat-notes';
    notes.textContent = beat.notes;
    el.appendChild(notes);
  }

  const foot = document.createElement('div');
  foot.className = 'beat-foot';

  const price = document.createElement('span');
  price.className = 'amount';
  price.textContent = money(beat.price);

  const buy = document.createElement('button');
  buy.className = 'btn primary';
  buy.textContent = 'Enquire to buy';
  buy.addEventListener('click', () => enquire(beat));

  foot.append(price, buy);
  el.append(createPlayer(beat.url), foot);
  return el;
}

/* ---------- search, filter, sort ---------- */

const controls = document.getElementById('storeControls');
const search = document.getElementById('storeSearch');
const filter = document.getElementById('storeFilter');
const sort = document.getElementById('storeSort');

function visible() {
  const q = search.value.trim().toLowerCase();
  const kind = filter.value;

  let list = all.filter((b) => {
    if (kind !== 'all' && b.type !== kind) return false;
    if (!q) return true;
    // Search what someone would actually type: the title, the producer, the genre, the key.
    return [b.title, b.ownerName, b.genre, b.key].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const by = {
    newest: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
    liked: (a, b) => (b.likes ?? 0) - (a.likes ?? 0),
    cheap: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    bpm: (a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity),
  }[sort.value];

  return list.sort(by);
}

function paint() {
  const list = visible();
  box.innerHTML = '';

  if (!list.length) {
    box.innerHTML = all.length
      ? '<p class="form-note">Nothing matches that.</p>'
      : '<p class="form-note">No beats posted yet — the studio below is open in the meantime.</p>';
    return;
  }

  list.forEach((b) => box.appendChild(card(b)));
}

[search, filter, sort].forEach((el) => el?.addEventListener('input', paint));

/* A beat page's "Enquire to buy" sends people here with ?buy=<id>. */
function prefillFromQuery() {
  const wanted = new URLSearchParams(location.search).get('buy');
  const beat = wanted && all.find((b) => b.id === wanted);
  if (beat) enquire(beat);
}

async function render() {
  skeleton(box, 3);

  try {
    const res = await fetch('/api/beats');
    if (!res.ok) throw new Error();
    all = await res.json();
  } catch {
    box.innerHTML =
      '<p class="form-note">The beat list is unavailable right now. ' +
      'Use the form below and I will send you what I have.</p>';
    return;
  }

  // The controls are useless with nothing to control.
  if (controls) controls.hidden = all.length < 2;

  paint();
  prefillFromQuery();
}

render();
