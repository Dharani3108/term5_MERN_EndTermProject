// Shared UI helpers: escaping, formatting, toasts, dialogs and page states.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

let timezone = 'Asia/Kolkata';
export const setTimezone = (tz) => {
  timezone = tz;
};
export const getTimezone = () => timezone;

const dtf = (opts) => new Intl.DateTimeFormat('en-IN', { timeZone: timezone, ...opts });

export const fmt = {
  dateTime: (iso) =>
    dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
  date: (iso) => dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)),
  time: (iso) => dtf({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
  range: (s, e) => `${fmt.date(s)} · ${fmt.time(s)} to ${fmt.time(e)}`,
  minutes: (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return `${r} min`;
    return r ? `${h} h ${r} min` : `${h} h`;
  },
  /** Campus-local calendar date (YYYY-MM-DD) of an instant. */
  localDate: (iso) => dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {}),
  hours: (m) => `${Math.round((m / 60) * 10) / 10} h`,
  pct: (x) => `${Math.round(x * 100)}%`,
  /** Label for a YYYY-MM-DD calendar date (no timezone shifting). */
  day: (dateStr) => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return {
      weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(d),
      day: d.getUTCDate(),
      month: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(d),
    };
  },
  ago: (iso) => {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return fmt.dateTime(iso);
  },
};

export const TYPE_LABELS = {
  study_room: 'Study room',
  meeting_room: 'Meeting room',
  lab: 'Lab',
  equipment: 'Equipment',
  sports: 'Sports',
};

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  waiting: 'Waiting',
  promoted: 'Booked from waitlist',
  expired: 'Expired',
};

export const statusBadge = (status) => `<span class="badge status-${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;

export const typeChip = (type) => `<span class="chip type-${esc(type)}">${esc(TYPE_LABELS[type] || type)}</span>`;

// ---------- page states ----------

export const loading = (text = 'Loading...') =>
  `<div class="state" role="status"><div class="spinner" aria-hidden="true"></div><p>${esc(text)}</p></div>`;

export const emptyState = (title, body = '', action = '') =>
  `<div class="state empty"><div class="state-icon" aria-hidden="true">○</div><h3>${esc(title)}</h3>${
    body ? `<p class="muted">${esc(body)}</p>` : ''
  }${action}</div>`;

export const errorState = (err) =>
  `<div class="state error" role="alert"><div class="state-icon" aria-hidden="true">!</div><h3>Could not load this</h3>
   <p class="muted">${esc(err?.message || 'Unexpected error.')}</p>
   <button class="btn" type="button" data-retry>Try again</button></div>`;

/** Renders an async section with loading, error-with-retry and success states. */
export async function section(container, loader, render) {
  container.innerHTML = loading();
  try {
    const data = await loader();
    render(data);
  } catch (err) {
    container.innerHTML = errorState(err);
    container.querySelector('[data-retry]')?.addEventListener('click', () => section(container, loader, render));
  }
}

// ---------- toasts ----------

export function toast(message, kind = 'info', timeout = 4500) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="Dismiss">×</button>`;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('button').addEventListener('click', close);
  host.appendChild(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

// ---------- dialogs ----------

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, input = null }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <form method="dialog" class="dialog-body">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(message)}</p>
        ${
          input
            ? `<label class="field"><span>${esc(input.label)}</span>
                 <input name="value" maxlength="${input.maxLength || 200}" placeholder="${esc(input.placeholder || '')}" ${input.required ? 'required minlength="3"' : ''}></label>`
            : ''
        }
        <div class="dialog-actions">
          <button class="btn" value="cancel" type="button" data-cancel>Keep it</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" value="ok" type="submit">${esc(confirmText)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let result = { ok: false };
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', (e) => {
      const field = form.querySelector('input[name=value]');
      if (field && !field.reportValidity()) {
        e.preventDefault();
        return;
      }
      result = { ok: true, value: field ? field.value.trim() : undefined };
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    (form.querySelector('input') || form.querySelector('[type=submit]')).focus();
  });
}

// ---------- forms ----------

export function setBusy(button, busy, busyText = 'Working...') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.classList.add('busy');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.classList.remove('busy');
  }
}

/** Shows API validation errors next to matching inputs, or as a form message. */
export function showFormError(form, err) {
  clearFormErrors(form);
  const details = err?.code === 'VALIDATION_ERROR' && err.details ? err.details : null;
  let unmatched = false;
  if (details) {
    for (const [field, msg] of Object.entries(details)) {
      const input = form.querySelector(`[name="${field}"]`);
      if (!input) {
        unmatched = true;
        continue;
      }
      input.setAttribute('aria-invalid', 'true');
      const note = document.createElement('small');
      note.className = 'field-error';
      const label = input.closest('.field')?.querySelector('span')?.textContent || field;
      note.textContent = `${label} ${msg}.`;
      input.insertAdjacentElement('afterend', note);
    }
  }
  const box = form.querySelector('.form-error');
  if (box && (!details || unmatched)) {
    box.textContent = details && unmatched ? Object.entries(details).map(([k, v]) => `${k} ${v}`).join('. ') : err.message;
    box.hidden = false;
  } else if (!box && (!details || unmatched)) {
    toast(err.message, 'error');
  }
  form.querySelector('[aria-invalid=true]')?.focus();
}

export function clearFormErrors(form) {
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  const box = form.querySelector('.form-error');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

/** Applies data-pct widths (inline styles are blocked by our CSP). */
export function applyBars(root) {
  root.querySelectorAll('[data-pct]').forEach((el) => {
    el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.pct)))}%`;
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms) {
  let h;
  return (...args) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}
