# ◆ BROWNBEATS — Music Producer

A producer's site with a working beat maker built into it. Visitors read the credits and
pricing, make an actual beat in the browser, export it as a WAV, and then book a session.

Every sound is synthesized live with the Web Audio API — no samples, no dependencies, no
build step.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## The page

Hero, selected work, service tiers, the studio, and a contact form. The form has no
backend: it opens the visitor's mail client with the booking details pre-filled. Swap the
handler at the bottom of `app.js` for a `fetch()` when there's an endpoint to post to.

## The studio

- **Drums** — kick, snare, clap, closed hat, open hat, tom, each one synthesized rather
  than sampled. The kick is a pitch-swept sine with a noise click on top; the clap is
  three fast noise bursts that smear together.
- **Melody** — a detuned-saw synth. Pick a key and a scale (minor/major pentatonic, blues,
  dorian, natural minor, major) and every note you click stays in key.
- **Mixer** — volume, mute (M) and solo (S) per track. Solo is exclusive-by-presence: if
  anything is soloed, everything else drops out.
- **Patterns and song mode** — four patterns (A–D). Turn on song mode and chain them into
  an arrangement; the grid follows along so you can see which bar is sounding.
- **Export WAV** — renders what would play (one bar, or the whole chain) and downloads it.
- **Transport** — tempo 60–180 BPM, swing, master volume. <kbd>Space</kbd> toggles play.
  Clicking a cell while stopped auditions the sound, so you can build a pattern by ear.
- **Save / Load** — keeps the whole session in `localStorage`.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | The page, plus the studio console markup |
| `audio.js` | `Synth` (voices + master bus), `AudioEngine` (live), `Exporter` (offline render → WAV) |
| `app.js` | Sequencer, mixer, patterns, song mode, scales, and UI wiring |
| `styles.css` | Styling |

## Two things worth knowing before you change the audio

**Timing.** `setInterval` drifts by several milliseconds, which is plainly audible as a
sloppy groove, so the timer never plays anything itself. It wakes every 25 ms and *queues*
notes falling in the next 120 ms directly on the Web Audio clock, which is sample-accurate.
The visual playhead is scheduled separately so the lights match what you hear.

**The output stage.** The voices are pure functions of `(ctx, destination, time)` rather
than methods on a live engine, because WAV export re-renders them through an
`OfflineAudioContext` — anything closing over a single `AudioContext` couldn't be reused
there, and the export would drift from what you hear.

The master bus ends in a compressor followed by a `tanh` waveshaper. That shaper is not
decoration: a kick, a clap and a few notes landing on the same 16th sum well past 1.0 and
hard-clip into buzz. The compressor rides the sustained level but its attack isn't
instantaneous, so transients still poke through; the shaper is bounded by construction and
is the actual ceiling. With both, a worst-case pattern (every voice on every beat) renders
at −1.1 dBFS with zero clipped samples. Remove the shaper and it clips outright.
