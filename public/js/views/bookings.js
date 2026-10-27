import { api, qs } from '../api.js';
import { esc, fmt, statusBadge, toast, confirmDialog, emptyState, section, applyBars, setBusy } from '../ui.js';
import { refreshAccount } from '../session.js';
import { accountStrip } from './common.js';

let tab = 'upcoming';

const isoDay = (iso) => {
  const p = fmt.localDate(iso);
  return `${p.year}-${p.month}-${p.day}`;
};

function bookingCard(b) {
  let actions = '';
  if (b.canCheckIn) actions += `<button class="btn primary small" data-checkin="${b.id}">Check in</button>`;
  else if (b.status === 'confirmed' && new Date(b.checkInOpensAt) > new Date()) {
    actions += `<span class="muted small">Check-in opens ${esc(fmt.dateTime(b.checkInOpensAt))}</span>`;
  }
  if (b.canCancel) actions += `<button class="btn small danger-ghost" data-cancel="${b.id}">Cancel</button>`;
  return `
    <article class="booking card">
      <div class="booking-main">
        <div class="row gap wrap">${statusBadge(b.status)}${b.source === 'waitlist' ? '<span class="chip">From waitlist</span>' : ''}</div>
        <h3><a href="#/resource/${b.resourceId}?date=${isoDay(b.startAt)}">${esc(b.resourceName)}</a></h3>
        <p class="when">${esc(fmt.range(b.startAt, b.endAt))}</p>
        <p class="muted small">${esc(b.building)} · ${b.attendees} ${b.attendees === 1 ? 'person' : 'people'}${b.purpose ? ` · ${esc(b.purpose)}` : ''}</p>
        ${b.cancelReason ? `<p class="muted small">Reason: ${esc(b.cancelReason)}</p>` : ''}
      </div>
      ${actions ? `<div class="booking-actions">${actions}</div>` : ''}
    </article>`;
}

function waitlistCard(w) {
  return `
    <article class="booking card">
      <div class="booking-main">
        <div class="row gap">${statusBadge(w.status)}${w.position ? `<span class="chip">Number ${w.position} in line</span>` : ''}</div>
        <h3><a href="#/resource/${w.resourceId}">${esc(w.resourceName)}</a></h3>
        <p class="when">${esc(fmt.range(w.startAt, w.endAt))}</p>
      </div>
      ${w.status === 'waiting' ? `<div class="booking-actions"><button class="btn small danger-ghost" data-leave="${w.id}">Leave waitlist</button></div>` : ''}
    </article>`;
}

export async function bookingsView({ el, isCurrent }) {
  el.innerHTML = `
    <div class="page-head"><div><h1>My bookings</h1><p class="muted">Check in when you arrive, cancel what you no longer need, and track your waitlists.</p></div></div>
    <div id="account">${accountStrip()}</div>
    <div class="tabs" role="tablist">
      ${['upcoming', 'past', 'waitlist']
        .map((t) => `<button role="tab" type="button" class="tab${t === tab ? ' active' : ''}" aria-selected="${t === tab}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)
        .join('')}
    </div>
    <div id="list"></div>`;
  applyBars(el);
  const list = el.querySelector('#list');

  const load = () =>
    section(
      list,
      () => (tab === 'waitlist' ? api('/waitlist/mine') : api(`/bookings/mine${qs({ scope: tab })}`)),
      ({ items }) => {
        if (!isCurrent()) return;
        if (!items.length) {
          const copy = {
            upcoming: ['No upcoming bookings', 'Find a free space and book it in a couple of clicks.'],
            past: ['No past bookings yet', 'Your completed, cancelled and missed bookings will appear here.'],
            waitlist: ['You are not on any waitlists', 'When a slot you want is taken, select it and join the waitlist.'],
          }[tab];
          list.innerHTML = emptyState(copy[0], copy[1], tab !== 'past' ? '<a class="btn primary" href="#/">Browse spaces</a>' : '');
          return;
        }
        list.innerHTML = `<div class="stack">${items.map(tab === 'waitlist' ? waitlistCard : bookingCard).join('')}</div>`;
      },
    );

  const reloadAccount = async () => {
    await refreshAccount();
    if (!isCurrent()) return;
    el.querySelector('#account').innerHTML = accountStrip();
    applyBars(el);
  };

  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      el.querySelectorAll('[data-tab]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-selected', String(x === b));
      });
      load();
    }),
  );

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-checkin], button[data-cancel], button[data-leave]');
    if (!btn) return;
    try {
      if (btn.dataset.checkin) {
        setBusy(btn, true, 'Checking in...');
        await api(`/bookings/${btn.dataset.checkin}/check-in`, { method: 'POST' });
        toast('Checked in. Enjoy your session!', 'success');
      } else if (btn.dataset.cancel) {
        const { ok } = await confirmDialog({
          title: 'Cancel this booking?',
          message: 'The time will be offered to people on the waitlist straight away. This cannot be undone.',
          confirmText: 'Cancel booking',
          danger: true,
        });
        if (!ok) return;
        setBusy(btn, true, 'Cancelling...');
        const r = await api(`/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST', body: {} });
        toast(r.promoted ? 'Booking cancelled. Someone on the waitlist got the slot.' : 'Booking cancelled.', 'success');
      } else if (btn.dataset.leave) {
        setBusy(btn, true, 'Leaving...');
        await api(`/waitlist/${btn.dataset.leave}`, { method: 'DELETE' });
        toast('You left the waitlist.', 'success');
      }
      await load();
      reloadAccount();
    } catch (err) {
      toast(err.message, 'error', 6000);
      if (btn.isConnected) setBusy(btn, false);
      load();
    }
  });

  // Refresh when something happens to our bookings, and every minute so the
  // check-in button appears on time.
  const onNotification = () => {
    if (!isCurrent()) return window.removeEventListener('slotwise:notification', onNotification);
    load();
    reloadAccount();
  };
  window.addEventListener('slotwise:notification', onNotification);
  const timer = setInterval(() => (isCurrent() ? tab === 'upcoming' && load() : clearInterval(timer)), 60_000);

  await load();
}
