// Admin console: analytics, resources, blackouts, bookings and users.
import { api, qs } from '../api.js';
import {
  esc, fmt, statusBadge, typeChip, TYPE_LABELS, toast, confirmDialog, emptyState, section,
  applyBars, setBusy, showFormError, clearFormErrors, debounce, getTimezone,
} from '../ui.js';
import { state } from '../session.js';

const TABS = [
  ['analytics', 'Analytics'],
  ['resources', 'Resources'],
  ['blackouts', 'Blackouts'],
  ['bookings', 'Bookings'],
  ['users', 'Users'],
];

export async function adminView({ el, params, isCurrent }) {
  const tab = TABS.some(([k]) => k === params[0]) ? params[0] : 'analytics';
  el.innerHTML = `
    <div class="page-head"><div><h1>Admin console</h1><p class="muted">Manage spaces, plan closures and see how campus spaces are really used.</p></div></div>
    <nav class="tabs" aria-label="Admin sections">
      ${TABS.map(([k, label]) => `<a class="tab${k === tab ? ' active' : ''}" href="#/admin/${k}" ${k === tab ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
    <div id="admin-body"></div>`;
  const body = el.querySelector('#admin-body');
  await { analytics, resources, blackouts, bookings, users }[tab](body, isCurrent);
}

// ---------- analytics ----------

async function analytics(body, isCurrent) {
  body.innerHTML = `
    <div class="row between wrap">
      <h2>Usage overview</h2>
      <label class="field inline"><span>Period</span>
        <select id="days"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select>
      </label>
    </div>
    <div id="analytics"></div>`;
  const box = body.querySelector('#analytics');
  const load = () =>
    section(box, () => api(`/admin/analytics${qs({ days: body.querySelector('#days').value })}`), (a) => {
      if (!isCurrent()) return;
      const t = a.totals;
      const kpi = (label, value, note = '') =>
        `<div class="kpi card"><span class="stat-label">${label}</span><span class="kpi-value">${value}</span>${note ? `<span class="muted small">${note}</span>` : ''}</div>`;
      const max = Math.max(1, ...a.heatmap.flat());
      const hours = Array.from({ length: 17 }, (_, i) => i + 6);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      box.innerHTML = `
        <div class="kpis">
          ${kpi('Bookings', t.bookings, `${t.activeUsers} active students`)}
          ${kpi('Utilisation', fmt.pct(t.utilization), 'checked-in time vs open hours')}
          ${kpi('No-show rate', fmt.pct(t.noShowRate), `${t.noShows} released automatically`)}
          ${kpi('Cancellations', t.cancellations, `${fmt.pct(t.cancellationRate)} of requests`)}
          ${kpi('Filled from waitlist', t.fromWaitlist, `${t.waitingNow} people waiting now`)}
          ${kpi('Next 7 days', t.upcomingNext7Days, 'confirmed bookings')}
        </div>
        <section class="card">
          <h3>Per resource</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Resource</th><th>Bookings</th><th>Used</th><th>Utilisation</th><th>No-shows</th><th>Cancelled</th></tr></thead>
            <tbody>${a.perResource
              .map(
                (r) => `<tr>
                <td>${esc(r.name)} ${r.active ? '' : '<span class="badge status-cancelled">Inactive</span>'}</td>
                <td>${r.bookings}</td>
                <td>${fmt.hours(r.usedMinutes)}</td>
                <td><div class="util"><div class="bar"><span data-pct="${Math.round(r.utilization * 100)}"></span></div><span>${fmt.pct(r.utilization)}</span></div></td>
                <td>${r.noShows} <span class="muted small">(${fmt.pct(r.noShowRate)}, ${fmt.hours(r.noShowMinutes)} lost)</span></td>
                <td>${r.cancellations}</td></tr>`,
              )
              .join('')}</tbody>
          </table></div>
        </section>
        <section class="card">
          <h3>When are spaces busiest?</h3>
          <p class="muted small">Booked time by weekday and hour (${esc(a.timezone)}). Darker means busier.</p>
          <div class="heatmap" role="table" aria-label="Booking heatmap">
            <div class="hm-row" role="row"><span></span>${hours.map((h) => `<span class="hm-h" role="columnheader">${h}</span>`).join('')}</div>
            ${a.heatmap
              .map(
                (row, d) => `<div class="hm-row" role="row"><span class="hm-d" role="rowheader">${days[d]}</span>${hours
                  .map((h) => {
                    const v = row[h];
                    const level = v ? Math.ceil((v / max) * 5) : 0;
                    return `<span class="hm-cell l${level}" role="cell" title="${days[d]} ${h}:00, ${fmt.hours(v)} booked"></span>`;
                  })
                  .join('')}</div>`,
              )
              .join('')}
          </div>
        </section>`;
      applyBars(box);
    });
  body.querySelector('#days').addEventListener('change', load);
  await load();
}

// ---------- resources ----------

async function resources(body, isCurrent) {
  body.innerHTML = `
    <div class="row between wrap"><h2>Resources</h2><button class="btn primary" type="button" id="new-res">Add resource</button></div>
    <div id="res-form-host"></div>
    <div id="res-list"></div>`;
  const list = body.querySelector('#res-list');
  const host = body.querySelector('#res-form-host');
  let items = [];

  const load = () =>
    section(list, () => api('/admin/resources'), (data) => {
      if (!isCurrent()) return;
      items = data.items;
      list.innerHTML = items.length
        ? `<div class="table-wrap card"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Building</th><th>Capacity</th><th>Hours</th><th>Max</th><th>Status</th><th></th></tr></thead>
            <tbody>${items
              .map(
                (r) => `<tr>
                <td><a href="#/resource/${r.id}">${esc(r.name)}</a></td><td>${typeChip(r.type)}</td><td>${esc(r.building)}</td>
                <td>${r.capacity}</td><td>${r.openTime} to ${r.closeTime}</td><td>${fmt.minutes(r.maxMinutes)}</td>
                <td>${r.active ? '<span class="badge status-confirmed">Active</span>' : '<span class="badge status-cancelled">Inactive</span>'}</td>
                <td class="actions"><button class="btn small" data-edit="${r.id}">Edit</button>
                  ${r.active ? `<button class="btn small danger-ghost" data-deactivate="${r.id}">Deactivate</button>` : `<button class="btn small" data-activate="${r.id}">Activate</button>`}</td>
              </tr>`,
              )
              .join('')}</tbody></table></div>`
        : emptyState('No resources yet', 'Add the first room, lab or piece of equipment.');
    });

  function openForm(r = null) {
    host.innerHTML = `
      <form class="card form-grid" id="res-form" novalidate>
        <h3 class="span-all">${r ? `Edit ${esc(r.name)}` : 'New resource'}</h3>
        <label class="field"><span>Name</span><input name="name" required maxlength="80" value="${esc(r?.name || '')}"></label>
        <label class="field"><span>Type</span><select name="type">${Object.entries(TYPE_LABELS)
          .map(([k, v]) => `<option value="${k}" ${r?.type === k ? 'selected' : ''}>${v}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Building</span><input name="building" required maxlength="80" value="${esc(r?.building || '')}"></label>
        <label class="field"><span>Capacity</span><input name="capacity" type="number" min="1" max="500" required value="${r?.capacity ?? 4}"></label>
        <label class="field"><span>Opens</span><input name="openTime" type="time" step="1800" required value="${r?.openTime || '08:00'}"></label>
        <label class="field"><span>Closes</span><input name="closeTime" type="time" step="1800" required value="${r?.closeTime || '22:00'}"></label>
        <label class="field"><span>Longest booking</span><select name="maxMinutes">${[30, 60, 90, 120, 180, 240, 360, 480]
          .map((m) => `<option value="${m}" ${(r?.maxMinutes ?? 120) === m ? 'selected' : ''}>${fmt.minutes(m)}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Amenities</span><input name="amenities" placeholder="Whiteboard, Projector" value="${esc((r?.amenities || []).join(', '))}"></label>
        <label class="field span-all"><span>Description</span><textarea name="description" maxlength="500" rows="2">${esc(r?.description || '')}</textarea></label>
        <div class="form-error span-all" role="alert" hidden></div>
        <div class="row gap span-all"><button class="btn primary" type="submit">${r ? 'Save changes' : 'Create resource'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
      </form>`;
    const form = host.querySelector('#res-form');
    form.querySelector('[data-close]').addEventListener('click', () => (host.innerHTML = ''));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFormErrors(form);
      const btn = form.querySelector('[type=submit]');
      setBusy(btn, true, 'Saving...');
      const payload = {
        name: form.name.value,
        type: form.type.value,
        building: form.building.value,
        capacity: Number(form.capacity.value),
        openTime: form.openTime.value,
        closeTime: form.closeTime.value,
        maxMinutes: Number(form.maxMinutes.value),
        amenities: form.amenities.value.split(',').map((s) => s.trim()).filter(Boolean),
        description: form.description.value,
      };
      try {
        await api(r ? `/admin/resources/${r.id}` : '/admin/resources', { method: r ? 'PUT' : 'POST', body: payload });
        toast(r ? 'Resource updated.' : 'Resource created.', 'success');
        host.innerHTML = '';
        load();
      } catch (err) {
        showFormError(form, err);
        setBusy(btn, false);
      }
    });
    form.name.focus();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  body.querySelector('#new-res').addEventListener('click', () => openForm());
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) return openForm(items.find((r) => r.id === Number(b.dataset.edit)));
    const id = b.dataset.deactivate || b.dataset.activate;
    if (!id) return;
    const deactivate = Boolean(b.dataset.deactivate);
    if (deactivate) {
      const { ok } = await confirmDialog({
        title: 'Deactivate this resource?',
        message: 'Students will no longer see it. All of its future bookings and waitlists are cancelled and the people affected are notified.',
        confirmText: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      setBusy(b, true, '...');
      const r = await api(`/admin/resources/${id}/${deactivate ? 'deactivate' : 'activate'}`, { method: 'POST' });
      toast(deactivate ? `Deactivated. ${r.cancelledBookings} future booking(s) cancelled and owners notified.` : 'Resource is active again.', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(b, false);
    }
  });
  await load();
}

// ---------- blackouts ----------

async function blackouts(body, isCurrent) {
  const res = await api('/admin/resources');
  if (!isCurrent()) return;
  body.innerHTML = `
    <h2>Blackout periods</h2>
    <p class="muted">Close a space (or all spaces) for maintenance, exams or events. Colliding bookings are cancelled and their owners are notified immediately.</p>
    <form class="card form-grid" id="bo-form" novalidate>
      <label class="field"><span>Resource</span><select name="resourceId"><option value="">All resources</option>${res.items
        .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Starts (${esc(getTimezone())})</span><input name="start" type="datetime-local" step="1800" required></label>
      <label class="field"><span>Ends</span><input name="end" type="datetime-local" step="1800" required></label>
      <label class="field"><span>Reason</span><input name="reason" required minlength="3" maxlength="120" placeholder="e.g. Deep cleaning"></label>
      <div class="form-error span-all" role="alert" hidden></div>
      <div class="span-all"><button class="btn primary" type="submit">Add blackout</button></div>
    </form>
    <div id="bo-list"></div>`;
  const list = body.querySelector('#bo-list');
  const form = body.querySelector('#bo-form');

  const load = () =>
    section(list, () => api('/admin/blackouts'), ({ items }) => {
      if (!isCurrent()) return;
      list.innerHTML = items.length
        ? `<div class="table-wrap card"><table><thead><tr><th>Resource</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead><tbody>
            ${items
              .map(
                (b) => `<tr><td>${esc(b.resourceName)}</td><td>${esc(fmt.dateTime(b.startAt))}</td><td>${esc(fmt.dateTime(b.endAt))}</td><td>${esc(b.reason)}</td>
                <td class="actions"><button class="btn small danger-ghost" data-del="${b.id}">Remove</button></td></tr>`,
              )
              .join('')}</tbody></table></div>`
        : emptyState('No upcoming blackouts', 'Every space is following its normal hours.');
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const { ok } = await confirmDialog({
      title: 'Add this blackout?',
      message: 'Any confirmed bookings in this period will be cancelled and their owners notified.',
      confirmText: 'Add blackout',
      danger: true,
    });
    if (!ok) return;
    const btn = form.querySelector('[type=submit]');
    setBusy(btn, true, 'Saving...');
    try {
      const r = await api('/admin/blackouts', {
        method: 'POST',
        body: {
          resourceId: form.resourceId.value ? Number(form.resourceId.value) : undefined,
          start: form.start.value,
          end: form.end.value,
          reason: form.reason.value,
        },
      });
      toast(`Blackout added for ${r.resourceName}. ${r.cancelledBookings} booking(s) cancelled, ${r.cancelledWaitlist} waitlist entr${r.cancelledWaitlist === 1 ? 'y' : 'ies'} removed.`, 'success', 7000);
      form.reset();
      load();
    } catch (err) {
      showFormError(form, err);
    } finally {
      setBusy(btn, false);
    }
  });

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const { ok } = await confirmDialog({ title: 'Remove blackout?', message: 'The space will become bookable again for this period. Cancelled bookings are not restored.', confirmText: 'Remove' });
    if (!ok) return;
    try {
      await api(`/admin/blackouts/${b.dataset.del}`, { method: 'DELETE' });
      toast('Blackout removed.', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await load();
}

// ---------- bookings ----------

async function bookings(body, isCurrent) {
  const res = await api('/admin/resources');
  if (!isCurrent()) return;
  const f = { q: '', status: '', resourceId: '', from: '', to: '', page: 1 };
  body.innerHTML = `
    <h2>All bookings</h2>
    <form class="filters card" id="bk-filters">
      <label class="field grow"><span>Search</span><input type="search" name="q" placeholder="Student name, email or purpose" maxlength="80"></label>
      <label class="field"><span>Status</span><select name="status"><option value="">Any</option>
        ${['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'].map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select></label>
      <label class="field"><span>Resource</span><select name="resourceId"><option value="">Any</option>${res.items.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
      <label class="field"><span>From</span><input type="date" name="from"></label>
      <label class="field"><span>To</span><input type="date" name="to"></label>
    </form>
    <div id="bk-list"></div>`;
  const form = body.querySelector('#bk-filters');
  const list = body.querySelector('#bk-list');

  const load = () =>
    section(list, () => api(`/admin/bookings${qs(f)}`), (data) => {
      if (!isCurrent()) return;
      if (!data.items.length) {
        list.innerHTML = emptyState('No bookings found', 'Try widening the filters.');
        return;
      }
      const now = Date.now();
      list.innerHTML = `
        <div class="table-wrap card"><table>
          <thead><tr><th>When</th><th>Resource</th><th>Student</th><th>Status</th><th>Purpose</th><th></th></tr></thead>
          <tbody>${data.items
            .map((b) => {
              const cancellable = ['confirmed', 'checked_in'].includes(b.status) && new Date(b.endAt).getTime() > now;
              return `<tr>
                <td>${esc(fmt.range(b.startAt, b.endAt))}</td><td>${esc(b.resourceName)}</td>
                <td>${esc(b.user.name)}<br><span class="muted small">${esc(b.user.email)}</span></td>
                <td>${statusBadge(b.status)}${b.source === 'waitlist' ? ' <span class="chip">waitlist</span>' : ''}</td>
                <td>${esc(b.purpose || '')}${b.cancelReason ? `<br><span class="muted small">${esc(b.cancelReason)}</span>` : ''}</td>
                <td class="actions">${cancellable ? `<button class="btn small danger-ghost" data-cancel="${b.id}">Cancel</button>` : ''}</td></tr>`;
            })
            .join('')}</tbody></table></div>
        <div class="pager">
          <button class="btn small" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="muted small">Page ${data.page} of ${data.pages} · ${data.total} bookings</span>
          <button class="btn small" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
        </div>`;
    });

  form.addEventListener('input', debounce(() => {
    Object.assign(f, { q: form.q.value.trim(), status: form.status.value, resourceId: form.resourceId.value, from: form.from.value, to: form.to.value, page: 1 });
    load();
  }, 300));
  form.addEventListener('submit', (e) => e.preventDefault());
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.page) {
      f.page = Number(b.dataset.page);
      return load();
    }
    if (b.dataset.cancel) {
      const { ok, value } = await confirmDialog({
        title: 'Cancel this booking?',
        message: 'The student is notified with your reason and the time is offered to the waitlist.',
        confirmText: 'Cancel booking',
        danger: true,
        input: { label: 'Reason shown to the student', placeholder: 'e.g. Room needed for exams', required: true },
      });
      if (!ok) return;
      try {
        const r = await api(`/admin/bookings/${b.dataset.cancel}/cancel`, { method: 'POST', body: { reason: value } });
        toast(`Booking cancelled.${r.promoted ? ` ${r.promoted} waitlisted student(s) booked instead.` : ''}`, 'success');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  await load();
}

// ---------- users ----------

async function users(body, isCurrent) {
  body.innerHTML = `
    <div class="row between wrap"><h2>Users</h2>
      <label class="field inline"><span class="sr-only">Search users</span><input type="search" id="user-q" placeholder="Search name or email" maxlength="80"></label></div>
    <div id="user-list"></div>`;
  const list = body.querySelector('#user-list');
  const q = body.querySelector('#user-q');

  const load = () =>
    section(list, () => api(`/admin/users${qs({ q: q.value.trim() })}`), ({ items }) => {
      if (!isCurrent()) return;
      list.innerHTML = items.length
        ? `<div class="table-wrap card"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Bookings</th><th>Upcoming</th><th>No-shows (30 days)</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (u) => `<tr>
              <td>${esc(u.name)}<br><span class="muted small">${esc(u.email)}</span></td>
              <td>${u.role === 'admin' ? '<span class="chip">Admin</span>' : 'Student'}</td>
              <td>${u.totalBookings}</td><td>${u.upcomingBookings}</td>
              <td>${u.recentStrikes}${u.suspendedUntil ? ` <span class="badge status-no_show">Paused until ${esc(fmt.date(u.suspendedUntil))}</span>` : ''}</td>
              <td class="actions">${
                u.id === state.user.id
                  ? '<span class="muted small">You</span>'
                  : `<button class="btn small" data-role="${u.role === 'admin' ? 'student' : 'admin'}" data-id="${u.id}">${u.role === 'admin' ? 'Make student' : 'Make admin'}</button>`
              }</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : emptyState('No users match', 'Try a different search.');
    });

  q.addEventListener('input', debounce(load, 300));
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    const { ok } = await confirmDialog({
      title: b.dataset.role === 'admin' ? 'Grant admin access?' : 'Remove admin access?',
      message: 'The user will be signed out everywhere so the change takes effect immediately.',
      confirmText: 'Change role',
      danger: b.dataset.role === 'admin',
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${b.dataset.id}/role`, { method: 'PUT', body: { role: b.dataset.role } });
      toast('Role updated.', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await load();
}
