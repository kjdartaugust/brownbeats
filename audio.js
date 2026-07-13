/* Synth engine. Every sound is generated with the Web Audio API — no samples.
 *
 * The voices are pure functions of (ctx, destination, time) rather than methods on a
 * live engine, because WAV export re-renders the exact same voices through an
 * OfflineAudioContext. Anything that closed over a single AudioContext could not be
 * reused there, and the export would drift from what you hear. */

const Synth = (() => {
  function noiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* Exponential-decay white noise, used as a cheap room impulse. */
  function impulseResponse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /* tanh transfer curve, scaled to leave ~0.7 dB of headroom at the ceiling. */
  function softClipCurve(samples = 8192) {
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1; // -1..1
      curve[i] = Math.tanh(x * 1.6) * 0.92;
    }
    return curve;
  }

  function envGain(ctx, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    return g;
  }

  function noiseHit(ctx, out, t, { duration, type, frequency, Q, peak }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, duration + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    if (Q) filter.Q.value = Q;

    const g = envGain(ctx, t, peak, 0.001, duration);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  const voices = {
    kick(ctx, out, t) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = envGain(ctx, t, 1, 0.001, 0.4);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.5);

      // Click transient so it still cuts through on laptop speakers.
      noiseHit(ctx, out, t, { duration: 0.02, type: 'highpass', frequency: 1500, peak: 0.25 });
    },

    snare(ctx, out, t) {
      noiseHit(ctx, out, t, { duration: 0.18, type: 'highpass', frequency: 1200, peak: 0.6 });
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, t);
      const g = envGain(ctx, t, 0.4, 0.001, 0.1);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.15);
    },

    clap(ctx, out, t) {
      // Three fast bursts is what gives a clap its signature smear.
      [0, 0.012, 0.024].forEach((offset, i) => {
        noiseHit(ctx, out, t + offset, {
          duration: i === 2 ? 0.16 : 0.03,
          type: 'bandpass',
          frequency: 1600,
          Q: 1.2,
          peak: 0.5,
        });
      });
    },

    hatClosed(ctx, out, t) {
      noiseHit(ctx, out, t, { duration: 0.05, type: 'highpass', frequency: 7000, peak: 0.28 });
    },

    hatOpen(ctx, out, t) {
      noiseHit(ctx, out, t, { duration: 0.32, type: 'highpass', frequency: 6500, peak: 0.22 });
    },

    tom(ctx, out, t) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.25);
      const g = envGain(ctx, t, 0.7, 0.002, 0.3);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.4);
    },
  };

  function drum(ctx, out, name, t) {
    if (voices[name]) voices[name](ctx, out, t);
  }

  /* Detuned saw pair through a plucky lowpass sweep. */
  function note(ctx, out, freq, t, duration = 0.22) {
    const g = envGain(ctx, t, 0.22, 0.008, duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + duration);
    filter.Q.value = 6;

    [-6, 6].forEach((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.1);
    });

    filter.connect(g).connect(out);
  }

  /* Master bus: per-track gains -> master -> destination, with a reverb send.
   * `gains` maps track id -> 0..1 and already accounts for mute/solo. */
  function buildBus(ctx, destination, trackIds, gains, masterVolume) {
    const master = ctx.createGain();
    master.gain.value = masterVolume;

    /* Output stage. A kick, a clap and a couple of notes landing on the same 16th sum
     * past 1.0 and hard-clip into buzz — audible live and baked into the export.
     *
     * The compressor rides the sustained level, but its attack is not instantaneous, so
     * transients still poke through. The tanh shaper after it is the actual ceiling:
     * it is bounded by construction, so no input can drive the output to full scale.
     * Together they saturate rather than clip. */
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '4x';

    comp.connect(shaper);
    shaper.connect(destination);
    const limiter = comp; // everything upstream feeds the output stage here

    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx, 1.4, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;

    master.connect(limiter);
    master.connect(reverb);
    reverb.connect(wet);
    wet.connect(limiter);

    const tracks = {};
    trackIds.forEach((id) => {
      const g = ctx.createGain();
      g.gain.value = gains[id] ?? 1;
      g.connect(master);
      tracks[id] = g;
    });

    return { master, tracks };
  }

  return { drum, note, buildBus };
})();

/* ---------- live playback ---------- */

const AudioEngine = (() => {
  let ctx = null;
  let bus = null;
  let trackIds = [];

  function init(ids, gains, masterVolume) {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    trackIds = ids;
    bus = Synth.buildBus(ctx, ctx.destination, ids, gains, masterVolume);
  }

  const out = (trackId) => (bus.tracks[trackId] ?? bus.master);

  return {
    init,
    ready: () => ctx !== null,
    now: () => (ctx ? ctx.currentTime : 0),
    resume: () => (ctx && ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()),

    playDrum(name, time) {
      if (ctx) Synth.drum(ctx, out(name), name, time);
    },

    playNote(freq, time) {
      if (ctx) Synth.note(ctx, out('melody'), freq, time);
    },

    setTrackGain(id, value) {
      if (bus && bus.tracks[id]) bus.tracks[id].gain.value = value;
    },

    setMasterVolume(v) {
      if (bus) bus.master.gain.value = v;
    },
  };
})();

/* ---------- offline render + WAV export ---------- */

const Exporter = (() => {
  /* Replays the scheduler's own note list into an OfflineAudioContext.
   * `events` is [{ type: 'drum'|'note', id|freq, time }] in seconds from zero. */
  async function render({ events, duration, trackIds, gains, masterVolume }) {
    const sampleRate = 44100;
    // Tail so the last hit's decay and reverb are not clipped off.
    const frames = Math.ceil((duration + 2) * sampleRate);
    const ctx = new OfflineAudioContext(2, frames, sampleRate);
    const bus = Synth.buildBus(ctx, ctx.destination, trackIds, gains, masterVolume);
    const out = (id) => bus.tracks[id] ?? bus.master;

    events.forEach((e) => {
      if (e.type === 'drum') Synth.drum(ctx, out(e.id), e.id, e.time);
      else Synth.note(ctx, out('melody'), e.freq, e.time);
    });

    return toWav(await ctx.startRendering());
  }

  function toWav(buffer) {
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const bytes = frames * channels * 2; // 16-bit
    const view = new DataView(new ArrayBuffer(44 + bytes));

    const str = (offset, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };

    str(0, 'RIFF');
    view.setUint32(4, 36 + bytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true); // byte rate
    view.setUint16(32, channels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    str(36, 'data');
    view.setUint32(40, bytes, true);

    const data = [];
    for (let ch = 0; ch < channels; ch++) data.push(buffer.getChannelData(ch));

    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = Math.max(-1, Math.min(1, data[ch][i]));
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  return { render };
})();
