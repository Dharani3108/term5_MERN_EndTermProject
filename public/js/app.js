// Hash router, top navigation and app bootstrap.
import { api } from './api.js';
import { esc, toast, errorState, setTimezone } from './ui.js';
import { state, loadMe, connectEvents, signOut } from './session.js';
import { loginView, registerView } from './views/auth.js';
import { browseView } from './views/browse.js';
import { resourceView } from './views/resource.js';
import { bookingsView } from './views/bookings.js';
import { notificationsView } from './views/notifications.js';
import { adminView } from './views/admin.js';

const routes = [
  { pattern: /^\/$/, view: browseView, nav: 'browse' },
  { pattern: /^\/resource\/(\d+)$/, view: resourceView, nav: 'browse' },
  { pattern: /^\/bookings$/, view: bookingsView, nav: 'bookings' },
  { pattern: /^\/notifications$/, view: notificationsView, nav: 'notifications' },
  { pattern: /^\/admin(?:\/([a-z]+))?$/, view: adminView, nav: 'admin', admin: true },
  { pattern: /^\/login$/, view: loginView, public: true },
  { pattern: /^\/register$/, view: registerView, public: true },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path, query: new URLSearchParams(search) };
}

let navToken = 0;

async function render() {
  const token = ++navToken;
  const { path, query } = parseHash();
  const el = document.getElementById('app');
  let match = null;
  const route = routes.find((r) => (match = r.pattern.exec(path)));

  if (!route) {
    renderNav(null);
    el.innerHTML = `<div class="state"><h2>Page not found</h2><p class="muted">That page does not exist.</p><a class="btn primary" href="#/">Go to spaces</a></div>`;
    return;
  }
  if (!route.public && !state.user) {
    location.replace('#/login');
    return;
  }
  if (route.public && state.user) {
    location.replace('#/');
    return;
  }
  if (route.admin && state.user.role !== 'admin') {
    renderNav(route.nav);
    el.innerHTML = `<div class="state error"><h2>Administrators only</h2><p class="muted">Your account does not have access to this area.</p><a class="btn" href="#/">Back to spaces</a></div>`;
    return;
  }

  renderNav(route.nav);
  el.innerHTML = '';
  try {
    await route.view({ el, params: match.slice(1), query, isCurrent: () => token === navToken });
  } catch (err) {
    if (token !== navToken) return;
    console.error(err);
    el.innerHTML = errorState(err);
    el.querySelector('[data-retry]')?.addEventListener('click', render);
  }
  if (token === navToken) {
    el.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function renderNav(active) {
  const bar = document.getElementById('topbar');
  if (!state.user) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  const link = (key, href, label, extra = '') =>
    `<a href="${href}" class="nav-link${active === key ? ' active' : ''}"${active === key ? ' aria-current="page"' : ''}>${label}${extra}</a>`;
  const badge = state.unread ? `<span class="nav-badge" aria-label="${state.unread} unread">${state.unread > 99 ? '99+' : state.unread}</span>` : '';
  bar.innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="#/"><img src="/favicon.svg" alt="" width="28" height="28"><span>SlotWise</span></a>
      <nav class="nav" aria-label="Main">
        ${link('browse', '#/', 'Spaces')}
        ${link('bookings', '#/bookings', 'My bookings')}
        ${link('notifications', '#/notifications', 'Alerts', badge)}
        ${state.user.role === 'admin' ? link('admin', '#/admin', 'Admin') : ''}
      </nav>
      <div class="user-menu">
        <span class="user-name" title="${esc(state.user.email)}">${esc(state.user.name)}${state.user.role === 'admin' ? ' <span class="chip">Admin</span>' : ''}</span>
        <button class="btn small ghost" type="button" id="logout-btn">Sign out</button>
      </div>
    </div>`;
  bar.querySelector('#logout-btn').addEventListener('click', () => signOut());
  bar.dataset.active = active || '';
}

window.addEventListener('slotwise:state', () => renderNav(document.getElementById('topbar').dataset.active || null));
window.addEventListener('slotwise:unauthorized', () => {
  if (!state.user) return;
  toast('Your session has expired. Please sign in again.', 'error');
  signOut({ expired: true });
});
window.addEventListener('hashchange', render);

async function boot() {
  try {
    state.config = await api('/config');
    setTimezone(state.config.timezone);
    await loadMe();
  } catch (err) {
    document.getElementById('app').innerHTML = errorState(err);
    document.querySelector('[data-retry]')?.addEventListener('click', boot);
    return;
  }
  if (state.user) connectEvents();
  render();
}

boot();
