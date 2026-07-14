/* The beat player.
 *
 * The native <audio> control was being restyled with a CSS invert() filter, which is a
 * hack: it renders differently in every browser, the filter mangles the colours, and on
 * a producer's site the player is the product. This is a real one.
 *
 * Only one plays at a time. Two beats at different tempos over each other is noise, and
 * on a phone a stray second player is genuinely hard to find and stop. */

const playing = new Set();

const mmss = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function createPlayer(src, { compact = false } = {}) {
  const el = document.createElement('div');
  el.className = compact ? 'player compact' : 'player';

  const audio = new Audio();
  audio.preload = 'none'; // don't pull megabytes for beats nobody plays
  audio.src = src;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'player-btn';
  button.setAttribute('aria-label', 'Play');
  button.textContent = '▶';

  /* The bar is the seek control, so it is a real slider: keyboard-reachable, and it
   * announces itself. A div with a click handler would be neither. */
  const bar = document.createElement('input');
  bar.type = 'range';
  bar.className = 'player-bar';
  bar.min = 0;
  bar.max = 1000;
  bar.value = 0;
  bar.setAttribute('aria-label', 'Seek');

  const time = document.createElement('span');
  time.className = 'player-time';
  time.textContent = '0:00';

  el.append(button, bar, time);

  const setPlayingUI = (on) => {
    button.textContent = on ? '❚❚' : '▶';
    button.setAttribute('aria-label', on ? 'Pause' : 'Play');
    el.classList.toggle('is-playing', on);
  };

  button.addEventListener('click', () => {
    if (audio.paused) {
      playing.forEach((other) => other !== audio && other.pause());
      audio.play().catch(() => {
        time.textContent = 'unplayable';
      });
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    playing.add(audio);
    setPlayingUI(true);
  });
  audio.addEventListener('pause', () => setPlayingUI(false));
  audio.addEventListener('ended', () => {
    setPlayingUI(false);
    bar.value = 0;
    time.textContent = mmss(audio.duration);
  });

  audio.addEventListener('loadedmetadata', () => (time.textContent = mmss(audio.duration)));

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration || seeking) return;
    bar.value = Math.round((audio.currentTime / audio.duration) * 1000);
    // Count down: what a listener wants to know is how much is left.
    time.textContent = mmss(audio.duration - audio.currentTime);
    el.style.setProperty('--progress', `${(audio.currentTime / audio.duration) * 100}%`);
  });

  // While a finger is on the bar, timeupdate must not fight it for the value.
  let seeking = false;
  bar.addEventListener('pointerdown', () => (seeking = true));
  bar.addEventListener('input', () => {
    el.style.setProperty('--progress', `${(bar.value / 1000) * 100}%`);
  });
  const commit = () => {
    if (!seeking) return;
    seeking = false;
    if (audio.duration) audio.currentTime = (bar.value / 1000) * audio.duration;
  };
  bar.addEventListener('pointerup', commit);
  bar.addEventListener('change', commit);

  return el;
}
