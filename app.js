/* The studio: a 16-step sequencer with a mixer, four patterns you can chain into a
 * song, selectable scales, and WAV export. */

const STEPS = 16;
const STORAGE_KEY = 'music-producer:session';
const LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
const SCHEDULE_AHEAD = 0.12;  // seconds of audio queued in advance
const PATTERN_IDS = ['A', 'B', 'C', 'D'];

const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'hatClosed', label: 'Hat' },
  { id: 'hatOpen', label: 'Open Hat' },
  { id: 'tom', label: 'Tom' },
];

const TRACK_IDS = [...DRUMS.map((d) => d.id), 'melody'];
const ROWS = 6; // melody rows; kept equal to the drum count so both grids line up

const ROOTS = [
  { label: 'C', midi: 60 },
  { label: 'D', midi: 62 },
  { label: 'E', midi: 64 },
  { label: 'F', midi: 65 },
  { label: 'G', midi: 67 },
  { label: 'A', midi: 69 },
];

/* Six scale degrees per scale, so every scale fills the same six-row grid. */
const SCALES = {
  minorPentatonic: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10, 12] },
  majorPentatonic: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9, 12] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9] },
  naturalMinor: { label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9] },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const midiToName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

const blankGrid = (rows) => Array.from({ length: rows }, () => new Array(STEPS).fill(false));
const blankPattern = () => ({ drums: blankGrid(DRUMS.length), melody: blankGrid(ROWS) });

const state = {
  playing: false,
  currentStep: 0,
  nextNoteTime: 0,
  bpm: 100,
  swing: 0,
  volume: 0.8,

  patterns: Object.fromEntries(PATTERN_IDS.map((id) => [id, blankPattern()])),
  editing: 'A',      // pattern shown in the grid
  playbackPattern: 'A', // pattern the scheduler is reading (differs in song mode)

  songMode: false,
  chain: ['A', 'A', 'B', 'A'],
  chainIndex: 0,

  root: 60,
  scale: 'minorPentatonic',

  mixer: Object.fromEntries(TRACK_IDS.map((id) => [id, { vol: 0.8, mute: false, solo: false }])),
};

let timerId = null;
const cells = { drums: [], melody: [] };
let notes = []; // current scale, highest pitch first so it reads like a piano roll

/* ---------- scale ---------- */

function rebuildNotes() {
  const steps = SCALES[state.scale].steps;
  notes = steps
    .map((s) => {
      const midi = state.root + 12 + s; // an octave up: sits above the drums
      return { label: midiToName(midi), freq: midiToFreq(midi) };
    })
    .reverse();
}

/* ---------- mixer ---------- */

/* Solo is exclusive-by-presence: if anything is soloed, everything else is silent. */
function gainFor(id) {
  const t = state.mixer[id];
  const anySolo = TRACK_IDS.some((x) => state.mixer[x].solo);
  if (t.mute) return 0;
  if (anySolo && !t.solo) return 0;
  return t.vol;
}

const allGains = () => Object.fromEntries(TRACK_IDS.map((id) => [id, gainFor(id)]));

function pushMixer() {
  TRACK_IDS.forEach((id) => AudioEngine.setTrackGain(id, gainFor(id)));
}

function ensureAudio() {
  AudioEngine.init(TRACK_IDS, allGains(), state.volume);
  return AudioEngine.resume();
}

/* ---------- grids ---------- */

function trackStrip(id) {
  const wrap = document.createDocumentFragment();
  const t = state.mixer[id];

  const mute = document.createElement('button');
  mute.className = 'mini';
  mute.textContent = 'M';
  mute.title = 'Mute';
  mute.classList.toggle('mute-on', t.mute);
  mute.addEventListener('click', () => {
    t.mute = !t.mute;
    mute.classList.toggle('mute-on', t.mute);
    pushMixer();
  });

  const solo = document.createElement('button');
  solo.className = 'mini';
  solo.textContent = 'S';
  solo.title = 'Solo';
  solo.classList.toggle('solo-on', t.solo);
  solo.addEventListener('click', () => {
    t.solo = !t.solo;
    solo.classList.toggle('solo-on', t.solo);
    pushMixer();
  });

  const vol = document.createElement('input');
  vol.type = 'range';
  vol.className = 'track-vol';
  vol.min = 0;
  vol.max = 100;
  vol.value = t.vol * 100;
  vol.title = 'Track volume';
  vol.addEventListener('input', () => {
    t.vol = Number(vol.value) / 100;
    pushMixer();
  });

  wrap.append(mute, solo, vol);
  return wrap;
}

function buildGrid(container, rows, gridName) {
  container.innerHTML = '';
  cells[gridName] = [];

  rows.forEach((row, r) => {
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = row.label;
    container.appendChild(label);

    // Drums mix per row. The melody synth is one instrument, so it gets a single
    // strip in the panel header instead of one per note.
    if (gridName === 'drums') {
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.appendChild(trackStrip(DRUMS[r].id));
      container.appendChild(strip);
    }

    const rowCells = [];
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.type = 'button';
      cell.dataset.step = s;
      if (s % 4 === 0) cell.classList.add('beat'); // mark beat boundaries
      cell.setAttribute('aria-label', `${row.label} step ${s + 1}`);
      cell.addEventListener('click', () => toggle(gridName, r, s));
      container.appendChild(cell);
      rowCells.push(cell);
    }
    cells[gridName].push(rowCells);
  });
}

function pattern() {
  return state.patterns[state.editing];
}

function toggle(gridName, r, s) {
  const grid = pattern()[gridName];
  const on = !grid[r][s];
  grid[r][s] = on;
  cells[gridName][r][s].classList.toggle('on', on);

  // Audition the sound, so a pattern can be built by ear while stopped.
  if (on && !state.playing) {
    ensureAudio().then(() => {
      const t = AudioEngine.now();
      if (gridName === 'drums') AudioEngine.playDrum(DRUMS[r].id, t);
      else AudioEngine.playNote(notes[r].freq, t);
    });
  }
}

function repaint() {
  ['drums', 'melody'].forEach((gridName) => {
    pattern()[gridName].forEach((row, r) => {
      row.forEach((on, s) => cells[gridName][r][s].classList.toggle('on', on));
    });
  });
}

function relabelMelody() {
  const labels = document.querySelectorAll('#melodyGrid .row-label');
  labels.forEach((el, i) => (el.textContent = notes[i].label));
}

/* ---------- scheduling ---------- */

const secondsPerStep = () => 60.0 / state.bpm / 4; // 16th notes
const barSeconds = () => secondsPerStep() * STEPS;

function advance() {
  const step = secondsPerStep();
  // Swing delays every off-beat 16th — that shuffle is the whole groove.
  const isOffbeat = state.currentStep % 2 === 1;
  const offset = step * (state.swing / 100) * 0.5;

  state.nextNoteTime += step + (isOffbeat ? -offset : offset);
  state.currentStep = (state.currentStep + 1) % STEPS;

  if (state.currentStep === 0 && state.songMode) nextInChain();
}

function nextInChain() {
  if (!state.chain.length) return;
  state.chainIndex = (state.chainIndex + 1) % state.chain.length;
  state.playbackPattern = state.chain[state.chainIndex];
  // Follow along in the grid so you can see which pattern is sounding.
  selectPattern(state.playbackPattern, { fromChain: true });
  markChain();
}

function scheduleStep(step, time) {
  const p = state.patterns[state.playbackPattern];

  p.drums.forEach((row, r) => {
    if (row[step]) AudioEngine.playDrum(DRUMS[r].id, time);
  });
  p.melody.forEach((row, r) => {
    if (row[step]) AudioEngine.playNote(notes[r].freq, time);
  });

  const delay = (time - AudioEngine.now()) * 1000;
  setTimeout(() => highlight(step), Math.max(delay, 0));
}

function highlight(step) {
  document.querySelectorAll('.cell.playhead').forEach((c) => c.classList.remove('playhead'));
  if (!state.playing) return;
  document.querySelectorAll(`.cell[data-step="${step}"]`).forEach((c) => c.classList.add('playhead'));
}

function scheduler() {
  while (state.nextNoteTime < AudioEngine.now() + SCHEDULE_AHEAD) {
    scheduleStep(state.currentStep, state.nextNoteTime);
    advance();
  }
}

/* ---------- transport ---------- */

const playBtn = document.getElementById('playBtn');
const statusEl = document.getElementById('status');
const setStatus = (msg) => (statusEl.textContent = msg);

async function start() {
  await ensureAudio();
  pushMixer();

  state.playing = true;
  state.currentStep = 0;
  state.chainIndex = 0;
  state.playbackPattern = state.songMode ? state.chain[0] : state.editing;
  if (state.songMode) {
    selectPattern(state.playbackPattern, { fromChain: true });
    markChain();
  }

  state.nextNoteTime = AudioEngine.now() + 0.05;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);

  playBtn.textContent = '■ Stop';
  playBtn.classList.add('active');
  setStatus(state.songMode ? `Playing song: ${state.chain.join(' → ')}` : `Playing pattern ${state.editing}.`);
}

function stop() {
  state.playing = false;
  clearInterval(timerId);
  timerId = null;
  highlight(-1);

  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('active');
  setStatus('Stopped.');
}

/* ---------- patterns + song mode ---------- */

function selectPattern(id, { fromChain = false } = {}) {
  state.editing = id;
  // In song mode the chain owns playback: clicking a pattern button only changes
  // which pattern you are editing, it does not jump the arrangement.
  if (!state.songMode || fromChain) state.playbackPattern = id;

  document.querySelectorAll('.pattern-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pattern === id);
  });
  repaint();
}

function markChain() {
  document.querySelectorAll('.chain-slot').forEach((el, i) => {
    el.classList.toggle('current', state.playing && state.songMode && i === state.chainIndex);
  });
}

function buildChainUI() {
  const box = document.getElementById('chain');
  box.innerHTML = '';

  state.chain.forEach((id, i) => {
    const slot = document.createElement('select');
    slot.className = 'chain-slot';
    PATTERN_IDS.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      slot.appendChild(opt);
    });
    slot.value = id;
    slot.addEventListener('change', () => (state.chain[i] = slot.value));
    box.appendChild(slot);
  });

  const remove = document.createElement('button');
  remove.className = 'mini';
  remove.textContent = '−';
  remove.title = 'Remove last bar';
  remove.addEventListener('click', () => {
    if (state.chain.length > 1) {
      state.chain.pop();
      buildChainUI();
    }
  });

  const add = document.createElement('button');
  add.className = 'mini';
  add.textContent = '+';
  add.title = 'Add a bar';
  add.addEventListener('click', () => {
    state.chain.push('A');
    buildChainUI();
  });

  box.append(remove, add);
  markChain();
}

/* ---------- generators ---------- */

function randomize() {
  const p = blankPattern();

  for (let s = 0; s < STEPS; s++) {
    if (s % 4 === 0) p.drums[0][s] = true;              // kick on every beat
    if (s % 8 === 4) p.drums[1][s] = true;              // snare on 2 and 4
    if (s % 2 === 0) p.drums[3][s] = true;              // steady hats
    if (Math.random() < 0.15) p.drums[2][s] = true;     // sprinkle claps
    if (Math.random() < 0.08) p.drums[5][s] = true;     // sprinkle toms
    if (Math.random() < 0.3) p.melody[Math.floor(Math.random() * ROWS)][s] = true;
  }

  state.patterns[state.editing] = p;
  repaint();
  setStatus(`Rolled a new pattern ${state.editing}.`);
}

function clearAll() {
  state.patterns[state.editing] = blankPattern();
  repaint();
  setStatus(`Cleared pattern ${state.editing}.`);
}

/* ---------- save / load ---------- */

function save() {
  const { patterns, chain, songMode, bpm, swing, volume, root, scale, mixer, editing } = state;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ patterns, chain, songMode, bpm, swing, volume, root, scale, mixer, editing })
  );
  setStatus('Session saved to this browser.');
}

/* localStorage is user-editable and survives changes to the grid's shape across
 * versions, so nothing from it is trusted: every field is coerced back into range
 * and anything unusable falls back to the default. */
function sanitize(raw) {
  const num = (v, min, max, fallback) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

  const grid = (g, rows) =>
    blankGrid(rows).map((row, r) =>
      row.map((_, s) => Array.isArray(g?.[r]) && g[r][s] === true)
    );

  const patterns = Object.fromEntries(
    PATTERN_IDS.map((id) => [
      id,
      {
        drums: grid(raw.patterns?.[id]?.drums, DRUMS.length),
        melody: grid(raw.patterns?.[id]?.melody, ROWS),
      },
    ])
  );

  const chain = Array.isArray(raw.chain)
    ? raw.chain.filter((id) => PATTERN_IDS.includes(id))
    : [];

  const mixer = Object.fromEntries(
    TRACK_IDS.map((id) => {
      const t = raw.mixer?.[id] ?? {};
      return [id, { vol: num(t.vol, 0, 1, 0.8), mute: t.mute === true, solo: t.solo === true }];
    })
  );

  return {
    patterns,
    chain: chain.length ? chain : ['A', 'A', 'B', 'A'],
    songMode: raw.songMode === true,
    bpm: num(raw.bpm, 60, 180, 100),
    swing: num(raw.swing, 0, 60, 0),
    volume: num(raw.volume, 0, 1, 0.8),
    root: ROOTS.some((r) => r.midi === raw.root) ? raw.root : 60,
    scale: Object.hasOwn(SCALES, raw.scale) ? raw.scale : 'minorPentatonic',
    mixer,
    editing: PATTERN_IDS.includes(raw.editing) ? raw.editing : 'A',
  };
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return setStatus('Nothing saved yet.');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return setStatus('Saved session was unreadable.');
  }
  if (!parsed || typeof parsed !== 'object') return setStatus('Saved session was unreadable.');

  if (state.playing) stop(); // the scheduler reads the grids it is about to replace
  Object.assign(state, sanitize(parsed));
  state.chainIndex = 0;
  state.playbackPattern = state.editing;

  rebuildNotes();
  relabelMelody();
  buildChainUI();
  syncControls();
  pushMixer();
  selectPattern(state.editing);
  setStatus('Session loaded.');
}

/* Rebuilds the drum grid so the mixer strips reflect loaded values. */
function syncControls() {
  setSlider('bpm', state.bpm);
  setSlider('swing', state.swing);
  setSlider('volume', Math.round(state.volume * 100));
  document.getElementById('root').value = state.root;
  document.getElementById('scale').value = state.scale;
  document.getElementById('songMode').checked = state.songMode;

  buildGrid(document.getElementById('drumGrid'), DRUMS, 'drums');
  document.getElementById('melodyStrip').innerHTML = '';
  document.getElementById('melodyStrip').appendChild(trackStrip('melody'));
  AudioEngine.setMasterVolume(state.volume);
}

function setSlider(id, value) {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

/* ---------- WAV export ---------- */

/* Flattens whatever would play — one bar, or the whole chain — into a list of
 * absolute-time events, then hands it to the offline renderer. */
function collectEvents() {
  const sequence = state.songMode ? state.chain : [state.editing];
  const step = secondsPerStep();
  const events = [];
  let barStart = 0;

  sequence.forEach((id) => {
    const p = state.patterns[id];

    for (let s = 0; s < STEPS; s++) {
      const isOffbeat = s % 2 === 1;
      const offset = step * (state.swing / 100) * 0.5;
      const time = barStart + s * step + (isOffbeat ? offset : 0);

      p.drums.forEach((row, r) => {
        if (row[s]) events.push({ type: 'drum', id: DRUMS[r].id, time });
      });
      p.melody.forEach((row, r) => {
        if (row[s]) events.push({ type: 'note', freq: notes[r].freq, time });
      });
    }
    barStart += barSeconds();
  });

  return { events, duration: barStart };
}

async function exportWav() {
  const { events, duration } = collectEvents();
  if (!events.length) return setStatus('Nothing to export — the pattern is empty.');

  setStatus('Rendering…');
  const blob = await Exporter.render({
    events,
    duration,
    trackIds: TRACK_IDS,
    gains: allGains(),
    masterVolume: state.volume,
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.songMode ? 'song.wav' : `pattern-${state.editing}.wav`;
  a.click();
  // Revoking in the same tick cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const bars = state.songMode ? state.chain.length : 1;
  setStatus(`Exported ${bars} bar${bars > 1 ? 's' : ''} as ${a.download}.`);
}

/* ---------- wiring ---------- */

rebuildNotes();
buildGrid(document.getElementById('drumGrid'), DRUMS, 'drums');
buildGrid(document.getElementById('melodyGrid'), notes, 'melody');
document.getElementById('melodyStrip').appendChild(trackStrip('melody'));

PATTERN_IDS.forEach((id) => {
  const btn = document.createElement('button');
  btn.className = 'pattern-btn';
  btn.dataset.pattern = id;
  btn.textContent = id;
  btn.addEventListener('click', () => selectPattern(id));
  document.getElementById('patterns').appendChild(btn);
});

buildChainUI();
selectPattern('A');

playBtn.addEventListener('click', () => (state.playing ? stop() : start()));
document.getElementById('randomBtn').addEventListener('click', randomize);
document.getElementById('clearBtn').addEventListener('click', clearAll);
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('loadBtn').addEventListener('click', load);
document.getElementById('exportBtn').addEventListener('click', exportWav);

document.getElementById('songMode').addEventListener('change', (e) => {
  state.songMode = e.target.checked;
  if (!state.songMode) state.playbackPattern = state.editing;
  markChain();
  setStatus(state.songMode ? 'Song mode: playing the chain.' : 'Pattern mode: looping one bar.');
});

document.getElementById('bpm').addEventListener('input', (e) => {
  state.bpm = Number(e.target.value);
  document.getElementById('bpmLabel').textContent = state.bpm;
});

document.getElementById('swing').addEventListener('input', (e) => {
  state.swing = Number(e.target.value);
  document.getElementById('swingLabel').textContent = state.swing;
});

document.getElementById('volume').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.volume = v / 100;
  document.getElementById('volLabel').textContent = v;
  AudioEngine.setMasterVolume(state.volume);
});

['root', 'scale'].forEach((id) => {
  document.getElementById(id).addEventListener('change', (e) => {
    state[id] = id === 'root' ? Number(e.target.value) : e.target.value;
    rebuildNotes();
    relabelMelody();
    setStatus(`Scale: ${midiToName(state.root).replace(/\d/, '')} ${SCALES[state.scale].label}.`);
  });
});

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  if (e.code !== 'Space' || typing) return;
  e.preventDefault();
  state.playing ? stop() : start();
});

randomize();
setStatus('Ready. Press Play (or hit Space).');

/* ---------- contact form ---------- */
/* No backend here, so the form opens the visitor's mail client with the booking
 * details pre-filled. Swap this for a fetch() when an endpoint exists. */

document.getElementById('contactForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const body = [
    `Name: ${f.name.value}`,
    `Email: ${f.email.value}`,
    `Service: ${f.service.value}`,
    `Budget: ${f.budget.value || 'not specified'}`,
    '',
    f.message.value,
  ].join('\n');

  window.location.href =
    `mailto:bookings@brownbeats.com?subject=${encodeURIComponent(`Booking — ${f.service.value}`)}` +
    `&body=${encodeURIComponent(body)}`;

  document.getElementById('formNote').textContent =
    'Opening your mail app with the details filled in — just hit send.';
});
