/* Small shared UI pieces: toasts, and the store's loading skeleton. */

let host = null;

function toastHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toasts';
  host.setAttribute('role', 'status');   // announced without stealing focus
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

/* `kind` is 'ok' | 'bad' | 'busy'. A busy toast stays until it is replaced or dismissed,
 * because it represents work still running. */
export function toast(message, kind = 'ok', { sticky = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastHost().appendChild(el);

  const dismiss = () => {
    el.classList.add('going');
    setTimeout(() => el.remove(), 200);
  };

  if (!sticky) setTimeout(dismiss, 3200);
  el.addEventListener('click', dismiss);

  return { dismiss, update: (text, k) => { el.textContent = text; if (k) el.className = `toast ${k}`; } };
}

/* Grey cards in the shape of the real ones, so the layout does not jump when the beats
 * arrive and the page does not look broken while they load. */
export function skeleton(box, count = 3) {
  box.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'card skeleton';
    card.innerHTML =
      '<div class="sk sk-tag"></div><div class="sk sk-title"></div>' +
      '<div class="sk sk-line"></div><div class="sk sk-player"></div>';
    box.appendChild(card);
  }
}
