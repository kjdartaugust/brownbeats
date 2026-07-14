/* The beat store. Reads /api/beats and renders a card per beat.
 *
 * Only one beat plays at a time — two beats at different tempos over each other is
 * noise, and on a phone a stray second player is hard to find and stop. */

(() => {
  const box = document.getElementById('beatStore');
  if (!box) return;

  const money = (n) => (typeof n === 'number' && n > 0 ? `₵${n.toLocaleString()}` : 'Ask');

  /* Fills the booking form with the beat, rather than opening a mail client: it keeps
   * the visitor on the page and every enquiry lands in the same inbox. */
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

    document.getElementById('formNote').textContent =
      `Buying "${beat.title}" — add your details and send.`;
  }

  function card(beat, players) {
    const el = document.createElement('article');
    el.className = 'card beat';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = beat.type === 'sample' ? 'Sample' : 'Beat';

    const title = document.createElement('h3');
    title.textContent = beat.title; // textContent, not innerHTML: this came from a form

    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = [beat.ownerName, beat.genre, beat.bpm && `${beat.bpm} BPM`, beat.key]
      .filter(Boolean)
      .join(' · ');

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none'; // don't pull megabytes of audio for beats nobody plays
    audio.src = beat.url;
    audio.className = 'beat-player';
    audio.addEventListener('play', () => {
      players.forEach((other) => other !== audio && other.pause());
    });
    players.push(audio);

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
    el.append(tag, title, meta);

    if (beat.notes) {
      const notes = document.createElement('p');
      notes.textContent = beat.notes;
      el.appendChild(notes);
    }

    el.append(audio, foot);
    return el;
  }

  async function render() {
    let beats;
    try {
      const res = await fetch('/api/beats');
      if (!res.ok) throw new Error();
      beats = await res.json();
    } catch {
      box.innerHTML =
        '<p class="form-note">The beat list is unavailable right now. ' +
        'Use the form below and I will send you what I have.</p>';
      return;
    }

    box.innerHTML = '';
    if (!beats.length) {
      box.innerHTML =
        '<p class="form-note">No beats posted yet — the studio below is open in the meantime.</p>';
      return;
    }

    const players = [];
    beats.forEach((b) => box.appendChild(card(b, players)));
  }

  render();
})();
