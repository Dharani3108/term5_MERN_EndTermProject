import { api } from '../api.js';
import { esc, fmt, toast, emptyState, section } from '../ui.js';
import { state, emit } from '../session.js';

const ICONS = {
  waitlist_promoted: '★',
  booking_cancelled: '✕',
  no_show: '!',
  reminder: '⏰',
  waitlist_expired: '…',
  welcome: '☺',
};

export async function notificationsView({ el, isCurrent }) {
  el.innerHTML = `
    <div class="page-head row between wrap">
      <div><h1>Alerts</h1><p class="muted">Reminders, waitlist news and changes to your bookings.</p></div>
      <button class="btn" type="button" id="read-all">Mark all as read</button>
    </div>
    <div id="list"></div>`;
  const list = el.querySelector('#list');

  const load = () =>
    section(list, () => api('/notifications'), ({ items, unread }) => {
      if (!isCurrent()) return;
      state.unread = unread;
      emit();
      list.innerHTML = items.length
        ? `<ul class="notifications card">${items
            .map(
              (n) => `
          <li class="${n.read ? '' : 'unread'}">
            <button type="button" data-id="${n.id}" data-link="${esc(n.link || '')}">
              <span class="n-icon n-${esc(n.type)}" aria-hidden="true">${ICONS[n.type] || '•'}</span>
              <span class="n-body"><span>${esc(n.message)}</span><small class="muted">${esc(fmt.ago(n.createdAt))}</small></span>
              ${n.read ? '' : '<span class="dot" aria-label="Unread"></span>'}
            </button>
          </li>`,
            )
            .join('')}</ul>`
        : emptyState('No alerts yet', 'You will be notified about reminders, waitlist promotions and cancellations here.');
    });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    try {
      const { unread } = await api(`/notifications/${btn.dataset.id}/read`, { method: 'POST' });
      state.unread = unread;
      emit();
    } catch (err) {
      toast(err.message, 'error');
    }
    if (btn.dataset.link) location.hash = btn.dataset.link;
    else load();
  });

  el.querySelector('#read-all').addEventListener('click', async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const onNotification = () => (isCurrent() ? load() : window.removeEventListener('slotwise:notification', onNotification));
  window.addEventListener('slotwise:notification', onNotification);
  await load();
}
