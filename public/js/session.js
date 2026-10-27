// Signed-in user state and the live event stream.
import { api } from './api.js';
import { toast } from './ui.js';

export const state = { user: null, account: null, config: null, unread: 0 };

let source = null;

export const emit = () => window.dispatchEvent(new CustomEvent('slotwise:state'));

export async function loadMe() {
  try {
    const r = await api('/auth/me');
    state.user = r.user;
    state.account = r.account;
  } catch (err) {
    if (err.status !== 401) throw err;
    state.user = null;
    state.account = null;
  }
  emit();
}

export async function refreshAccount() {
  if (!state.user) return;
  try {
    const r = await api('/auth/me');
    state.account = r.account;
    emit();
  } catch {
    // Non-critical: the account strip just keeps its previous numbers.
  }
}

const TOAST_KIND = { waitlist_promoted: 'success', booking_cancelled: 'error', no_show: 'error', reminder: 'info' };

export function connectEvents() {
  disconnectEvents();
  if (!state.user || !window.EventSource) return;
  source = new EventSource('/api/events');
  source.addEventListener('hello', (e) => {
    state.unread = JSON.parse(e.data).unread;
    emit();
  });
  source.addEventListener('notification', (e) => {
    const d = JSON.parse(e.data);
    state.unread = d.unread;
    emit();
    toast(d.message, TOAST_KIND[d.type] || 'info', 8000);
    refreshAccount();
    window.dispatchEvent(new CustomEvent('slotwise:notification', { detail: d }));
  });
  source.addEventListener('availability', (e) => {
    window.dispatchEvent(new CustomEvent('slotwise:availability', { detail: JSON.parse(e.data) }));
  });
}

export function disconnectEvents() {
  if (source) source.close();
  source = null;
}

export async function signedIn() {
  await loadMe();
  connectEvents();
}

export async function signOut({ expired = false } = {}) {
  if (!expired) {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Clear local state regardless.
    }
  }
  disconnectEvents();
  state.user = null;
  state.account = null;
  state.unread = 0;
  emit();
  location.hash = '#/login';
}
