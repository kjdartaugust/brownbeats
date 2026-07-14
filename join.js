/* Sign in / create an account. Both land on the dashboard. */

(() => {
  const signin = document.getElementById('signinForm');
  const signup = document.getElementById('signupForm');
  const tabSignin = document.getElementById('tabSignin');
  const tabSignup = document.getElementById('tabSignup');

  function tab(showSignup) {
    signup.hidden = !showSignup;
    signin.hidden = showSignup;
    tabSignup.classList.toggle('active', showSignup);
    tabSignin.classList.toggle('active', !showSignup);
  }

  tabSignin.addEventListener('click', () => tab(false));
  tabSignup.addEventListener('click', () => tab(true));

  // Where a signed-in person belongs: a listener has no dashboard to go to.
  const home = (user) => (user.role === 'listener' ? '/#beats' : '/dashboard');

  // Already signed in? Don't make them do it again.
  fetch('/api/auth')
    .then((r) => r.json())
    .then((d) => d.user && location.replace(home(d.user)))
    .catch(() => {});

  async function submit(form, note, body) {
    note.textContent = 'Just a moment…';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        note.textContent = data.error ?? 'That did not work.';
        return;
      }
      location.href = home(data.user);
    } catch {
      note.textContent = 'Could not reach the server.';
    }
  }

  signin.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(signin, document.getElementById('signinNote'), {
      action: 'signin',
      email: signin.email.value,
      password: signin.password.value,
    });
  });

  signup.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(signup, document.getElementById('signupNote'), {
      action: 'signup',
      name: signup.name.value,
      email: signup.email.value,
      password: signup.password.value,
      // The server decides what this is worth: it will not mint an admin, whatever
      // is sent here.
      role: signup.role.value,
    });
  });
})();
