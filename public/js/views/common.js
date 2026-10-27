// Pieces shared by several views.
import { esc, fmt } from '../ui.js';
import { state } from '../session.js';

/** Weekly quota, active bookings and strike status for the signed-in student. */
export function accountStrip() {
  const a = state.account;
  if (!a || a.weeklyQuotaMinutes === null) return '';
  const pct = Math.round((a.weeklyUsedMinutes / a.weeklyQuotaMinutes) * 100);
  const suspended = a.strikes.suspendedUntil
    ? `<div class="alert error">Booking is paused after ${a.strikes.count} no-shows. You can book again from ${esc(
        fmt.dateTime(a.strikes.suspendedUntil),
      )}.</div>`
    : '';
  return `
    ${suspended}
    <div class="account-strip card">
      <div class="stat">
        <span class="stat-label">This week</span>
        <span class="stat-value">${fmt.hours(a.weeklyUsedMinutes)} <small>of ${fmt.hours(a.weeklyQuotaMinutes)}</small></span>
        <div class="bar"><span data-pct="${pct}" class="${pct >= 90 ? 'warn' : ''}"></span></div>
      </div>
      <div class="stat">
        <span class="stat-label">Upcoming bookings</span>
        <span class="stat-value">${a.activeBookings} <small>of ${a.maxActiveBookings}</small></span>
      </div>
      <div class="stat">
        <span class="stat-label">No-shows (${a.strikes.windowDays} days)</span>
        <span class="stat-value ${a.strikes.count ? 'warn-text' : ''}">${a.strikes.count} <small>of ${a.strikes.limit} allowed</small></span>
      </div>
    </div>`;
}
