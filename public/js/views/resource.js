// Resource detail: date picker, live slot grid, range selection and the
// book / join-waitlist panel.
import { api, qs } from '../api.js';
import { esc, fmt, typeChip, toast, loading, errorState, setBusy, uuid } from '../ui.js';
import { state, refreshAccount } from '../session.js';

const SELECTABLE = new Set(['free', 'booked']);

export async function resourceView({ el, params, query, isCurrent }) {
  const id = Number(params[0]);
  let date = query.get('date') || null;
  let data = null;
  let sel = null; // { a, b } inclusive slot indexes
  let idemKey = uuid();
  let submitting = false;

  el.innerHTML = loading('Loading schedule...');

  async function load({ quiet = false } = {}) {
    if (!quiet) {
      const grid = el.querySelector('#grid');
      if (grid) grid.classList.add('stale');
    }
    const next = await api(`/resources/${id}/availability${qs({ date })}`);
    if (!isCurrent()) return;
    data = next;
    date = data.date;
    // Keep the selection only if it is still entirely selectable.
    if (sel && !data.slots.slice(sel.a, sel.b + 1).every((s) => SELECTABLE.has(s.status))) sel = null;
    render();
  }

  function render() {
    const r = data.resource;
    if (!el.querySelector('#grid')) {
      el.innerHTML = `
        <a class="back" href="#/">← All spaces</a>
        <div class="page-head">
          <div>
            <div class="row gap">${typeChip(r.type)}${r.active ? '' : '<span class="badge status-cancelled">Inactive</span>'}</div>
            <h1>${esc(r.name)}</h1>
            <p class="muted">${esc(r.building)} · Up to ${r.capacity} ${r.capacity === 1 ? 'person' : 'people'} · Open ${esc(r.openTime)} to ${esc(r.closeTime)} · Max ${fmt.minutes(r.maxMinutes)} per booking</p>
            ${r.description ? `<p>${esc(r.description)}</p>` : ''}
            ${r.amenities.length ? `<div class="tags">${r.amenities.map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        <div class="date-strip" id="dates" role="tablist" aria-label="Choose a date"></div>
        <div class="schedule">
          <section class="card">
            <div class="row between wrap">
              <h2 id="day-title"></h2>
              <ul class="legend" aria-label="Legend">
                <li><i class="slot-dot free"></i>Free</li><li><i class="slot-dot selected"></i>Selected</li>
                <li><i class="slot-dot booked"></i>Booked</li><li><i class="slot-dot mine"></i>Yours</li>
                <li><i class="slot-dot blackout"></i>Unavailable</li>
              </ul>
            </div>
            <p class="muted small">Click a start slot, then an end slot. Booked times can be waitlisted. The schedule updates live.</p>
            <div id="grid" class="slot-grid" role="grid"></div>
          </section>
          <aside class="card panel" id="panel" aria-live="polite"></aside>
        </div>`;
    }
    renderDates();
    renderGrid();
    renderPanel();
  }

  function renderDates() {
    const box = el.querySelector('#dates');
    const days = [];
    for (let d = data.minDate; d <= data.maxDate; d = nextDay(d)) days.push(d);
    box.innerHTML = days
      .map((d) => {
        const f = fmt.day(d);
        return `<button type="button" role="tab" class="date-btn${d === date ? ' active' : ''}" aria-selected="${d === date}" data-date="${d}">
          <span>${f.weekday}</span><strong>${f.day}</strong><span>${f.month}</span></button>`;
      })
      .join('');
    box.querySelectorAll('[data-date]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (b.dataset.date === date) return;
        date = b.dataset.date;
        sel = null;
        idemKey = uuid();
        history.replaceState(null, '', `#/resource/${id}?date=${date}`);
        try {
          await load();
        } catch (err) {
          toast(err.message, 'error');
        }
      }),
    );
    box.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const f = fmt.day(date);
    el.querySelector('#day-title').textContent = `${f.weekday} ${f.day} ${f.month}`;
  }

  function renderGrid() {
    const grid = el.querySelector('#grid');
    grid.classList.remove('stale');
    const allPast = data.slots.every((s) => s.status === 'past');
    if (!data.slots.length || allPast) {
      grid.innerHTML = `<p class="muted">${allPast ? 'All slots for this day have passed. Pick another date.' : 'No bookable slots on this day.'}</p>`;
      return;
    }
    grid.innerHTML = data.slots
      .map((s, i) => {
        const inSel = sel && i >= sel.a && i <= sel.b;
        const cls = ['slot', s.status, inSel ? 'selected' : '', s.waitlisted ? 'waitlisted' : ''].join(' ');
        const disabled = !SELECTABLE.has(s.status) && s.status !== 'mine';
        const title =
          s.status === 'blackout' ? `Unavailable${s.reason ? `: ${s.reason}` : ''}` :
          s.status === 'booked' ? 'Booked. Select to join the waitlist.' :
          s.status === 'mine' ? 'Your booking' :
          s.status === 'past' ? 'In the past' :
          s.status === 'closed' ? 'Not bookable yet' : 'Free';
        const sub = s.status === 'mine' ? 'Yours' : s.status === 'booked' ? 'Booked' : s.status === 'blackout' ? 'Closed' : s.waitlisted ? 'Waitlisted' : '';
        return `<button type="button" class="${cls}" data-i="${i}" ${disabled ? 'disabled' : ''} title="${esc(title)}" aria-pressed="${Boolean(inSel)}">
          <span>${esc(s.label)}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
      })
      .join('');
    grid.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => onSlot(Number(b.dataset.i))));
  }

  function onSlot(i) {
    const s = data.slots[i];
    if (s.status === 'mine') {
      toast('You already hold this slot. Manage it under My bookings.', 'info');
      return;
    }
    if (!SELECTABLE.has(s.status)) return;
    const max = data.resource.maxMinutes / data.slotMinutes;
    if (!sel || sel.a !== sel.b || i < sel.a) {
      sel = sel && sel.a === i && sel.b === i ? null : { a: i, b: i };
    } else if (i === sel.a) {
      sel = null;
    } else {
      const range = data.slots.slice(sel.a, i + 1);
      if (!range.every((x) => SELECTABLE.has(x.status))) {
        toast('That stretch crosses unavailable time. Choose a continuous range.', 'error');
        sel = { a: i, b: i };
      } else if (i - sel.a + 1 > max) {
        toast(`${data.resource.name} can be booked for at most ${fmt.minutes(data.resource.maxMinutes)}.`, 'error');
      } else {
        sel = { a: sel.a, b: i };
      }
    }
    idemKey = uuid();
    renderGrid();
    renderPanel();
  }

  function renderPanel() {
    const panel = el.querySelector('#panel');
    const r = data.resource;
    if (!sel) {
      panel.innerHTML = `<h2>Your booking</h2><p class="muted">Select a time on the grid to get started.</p>
        <ul class="rules muted small">
          <li>Check in from ${state.config.policy.checkInEarlyMinutes} minutes before your start time.</li>
          <li>Unclaimed bookings are released ${state.config.policy.noShowGraceMinutes} minutes after the start.</li>
          <li>Students can book up to ${state.config.policy.weeklyQuotaMinutes / 60} hours a week.</li>
        </ul>`;
      return;
    }
    const start = data.slots[sel.a].startAt;
    const end = data.slots[sel.b].endAt;
    const minutes = (sel.b - sel.a + 1) * data.slotMinutes;
    const waitlist = data.slots.slice(sel.a, sel.b + 1).some((s) => s.status === 'booked');
    panel.innerHTML = `
      <h2>${waitlist ? 'Join the waitlist' : 'Confirm booking'}</h2>
      <p class="selection"><strong>${esc(fmt.date(start))}</strong><br>${esc(fmt.time(start))} to ${esc(fmt.time(end))} <span class="muted">(${fmt.minutes(minutes)})</span></p>
      ${waitlist ? `<div class="alert info">Part of this time is already booked. Join the waitlist and SlotWise will book it for you automatically if it frees up.</div>` : ''}
      <form id="book-form" novalidate>
        <label class="field"><span>People</span><input name="attendees" type="number" min="1" max="${r.capacity}" value="1" required></label>
        <label class="field"><span>Purpose (optional)</span><input name="purpose" maxlength="200" placeholder="e.g. DBMS group project"></label>
        <button class="btn primary block" type="submit">${waitlist ? 'Join waitlist' : 'Book now'}</button>
        <button class="btn ghost block" type="button" data-clear>Clear selection</button>
      </form>`;
    panel.querySelector('[data-clear]').addEventListener('click', () => {
      sel = null;
      renderGrid();
      renderPanel();
    });
    panel.querySelector('#book-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(e.target, { start, end, waitlist });
    });
  }

  async function submit(form, { start, end, waitlist }) {
    if (submitting) return;
    const attendees = Number(form.attendees.value);
    if (!Number.isInteger(attendees) || attendees < 1 || attendees > data.resource.capacity) {
      toast(`Enter between 1 and ${data.resource.capacity} people.`, 'error');
      form.attendees.focus();
      return;
    }
    submitting = true;
    const btn = form.querySelector('[type=submit]');
    setBusy(btn, true, waitlist ? 'Joining...' : 'Booking...');
    const body = { resourceId: id, startAt: start, endAt: end, attendees, purpose: form.purpose.value };
    try {
      if (waitlist) {
        const { entry } = await api('/waitlist', { method: 'POST', body });
        toast(`You are number ${entry.position} in line. We will notify you if it frees up.`, 'success', 6000);
      } else {
        // The same key is reused if the user retries, so a lost response can never create two bookings.
        const { booking } = await api('/bookings', { method: 'POST', body, headers: { 'Idempotency-Key': idemKey } });
        toast(`Booked ${booking.resourceName} for ${fmt.range(booking.startAt, booking.endAt)}.`, 'success', 6000);
      }
      sel = null;
      idemKey = uuid();
      refreshAccount();
      await load({ quiet: true });
    } catch (err) {
      if (err.code === 'NETWORK_ERROR') {
        toast('Network problem. Your request may not have been saved. It is safe to press the button again.', 'error', 8000);
      } else {
        toast(err.message, 'error', 7000);
        if (['SLOT_TAKEN', 'SLOT_AVAILABLE', 'BLACKED_OUT', 'IN_PAST'].includes(err.code)) {
          idemKey = uuid();
          await load({ quiet: true }).catch(() => {});
        }
      }
    } finally {
      submitting = false;
      if (btn.isConnected) setBusy(btn, false);
    }
  }

  // Live updates: someone else booked or cancelled on this day.
  const onAvailability = (e) => {
    if (!isCurrent()) {
      window.removeEventListener('slotwise:availability', onAvailability);
      return;
    }
    const d = e.detail;
    if ((d.resourceId === id || d.resourceId === 0) && d.date === date && !submitting) {
      load({ quiet: true }).catch(() => {});
    }
  };
  window.addEventListener('slotwise:availability', onAvailability);

  try {
    await load();
  } catch (err) {
    el.innerHTML = `<a class="back" href="#/">← All spaces</a>${errorState(err)}`;
    el.querySelector('[data-retry]').addEventListener('click', () => resourceView({ el, params, query, isCurrent }));
  }
}

function nextDay(d) {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
