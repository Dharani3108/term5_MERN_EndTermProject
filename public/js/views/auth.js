import { api } from '../api.js';
import { esc, toast, setBusy, showFormError, clearFormErrors } from '../ui.js';
import { state, signedIn } from '../session.js';

const brand = `<div class="auth-brand"><img src="/favicon.svg" alt="" width="40" height="40"><span>SlotWise</span></div>`;
const pitch = `
  <aside class="auth-pitch">
    <h2>Shared campus spaces, booked fairly.</h2>
    <ul class="ticks">
      <li>See live availability for study rooms, labs, equipment and courts.</li>
      <li>Book in seconds. Double bookings are impossible by design.</li>
      <li>Join a waitlist and get booked automatically when a slot frees up.</li>
      <li>Check in on arrival. Unclaimed rooms are released for others.</li>
    </ul>
  </aside>`;

async function finish(user, verb) {
  await signedIn();
  toast(`${verb}, ${user.name.split(' ')[0]}!`, 'success');
  location.hash = '#/';
}

export async function loginView({ el }) {
  const demo = state.config?.demo;
  el.innerHTML = `
    <section class="auth-wrap">
      ${pitch}
      <div class="auth-card card">
        ${brand}
        <h1>Sign in</h1>
        <form id="login-form" novalidate>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
          <div class="form-error" role="alert" hidden></div>
          <button class="btn primary block" type="submit">Sign in</button>
        </form>
        <p class="muted small center">New to SlotWise? <a href="#/register">Create an account</a></p>
        ${
          demo
            ? `<div class="demo-box">
                 <strong>Try the demo</strong>
                 <button type="button" class="btn small" data-email="${esc(demo.student.email)}" data-password="${esc(demo.student.password)}">Fill student login</button>
                 <button type="button" class="btn small" data-email="${esc(demo.admin.email)}" data-password="${esc(demo.admin.password)}">Fill admin login</button>
               </div>`
            : ''
        }
      </div>
    </section>`;

  const form = el.querySelector('#login-form');
  el.querySelectorAll('[data-email]').forEach((b) =>
    b.addEventListener('click', () => {
      form.email.value = b.dataset.email;
      form.password.value = b.dataset.password;
      form.querySelector('[type=submit]').focus();
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const btn = form.querySelector('[type=submit]');
    setBusy(btn, true, 'Signing in...');
    try {
      const { user } = await api('/auth/login', {
        method: 'POST',
        body: { email: form.email.value, password: form.password.value },
      });
      await finish(user, 'Welcome back');
    } catch (err) {
      showFormError(form, err);
    } finally {
      setBusy(btn, false);
    }
  });
  form.email.focus();
}

export async function registerView({ el }) {
  el.innerHTML = `
    <section class="auth-wrap">
      ${pitch}
      <div class="auth-card card">
        ${brand}
        <h1>Create your account</h1>
        <form id="register-form" novalidate>
          <label class="field"><span>Full name</span><input name="name" autocomplete="name" required minlength="2" maxlength="60"></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128">
            <small class="hint">At least 8 characters, with a letter and a number.</small></label>
          <div class="form-error" role="alert" hidden></div>
          <button class="btn primary block" type="submit">Create account</button>
        </form>
        <p class="muted small center">Already registered? <a href="#/login">Sign in</a></p>
      </div>
    </section>`;

  const form = el.querySelector('#register-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const btn = form.querySelector('[type=submit]');
    setBusy(btn, true, 'Creating account...');
    try {
      const { user } = await api('/auth/register', {
        method: 'POST',
        body: { name: form.name.value, email: form.email.value, password: form.password.value },
      });
      await finish(user, 'Welcome');
    } catch (err) {
      showFormError(form, err);
    } finally {
      setBusy(btn, false);
    }
  });
  form.name.focus();
}
