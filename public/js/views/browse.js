import { api, qs } from '../api.js';
import { esc, fmt, typeChip, TYPE_LABELS, loading, emptyState, errorState, applyBars, debounce, getTimezone } from '../ui.js';
import { accountStrip } from './common.js';

// Filters survive navigating to a resource and back.
const filters = { q: '', type: '', building: '', minCapacity: '', freeNow: false };

function card(r) {
  return `
    <a class="resource-card card" href="#/resource/${r.id}">
      <div class="rc-top">
        ${typeChip(r.type)}
        ${r.freeNow ? '<span class="pill free">Free now</span>' : '<span class="pill">Not free now</span>'}
      </div>
      <h3>${esc(r.name)}</h3>
      <p class="muted">${esc(r.building)}</p>
      <dl class="meta">
        <div><dt>Capacity</dt><dd>${r.capacity} ${r.capacity === 1 ? 'person' : 'people'}</dd></div>
        <div><dt>Hours</dt><dd>${esc(r.openTime)} to ${esc(r.closeTime)}</dd></div>
        <div><dt>Max booking</dt><dd>${fmt.minutes(r.maxMinutes)}</dd></div>
      </dl>
      ${r.amenities.length ? `<div class="tags">${r.amenities.map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>` : ''}
    </a>`;
}

export async function browseView({ el, isCurrent }) {
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Find a space</h1>
        <p class="muted">Pick a room, lab, kit or court to see its live schedule. All times are campus time (${esc(getTimezone())}).</p>
      </div>
    </div>
    <div id="account">${accountStrip()}</div>
    <form class="filters card" id="filters" role="search">
      <label class="field grow"><span>Search</span><input type="search" name="q" placeholder="Name, building or description" value="${esc(filters.q)}" maxlength="80"></label>
      <label class="field"><span>Type</span><select name="type"><option value="">All types</option>${Object.entries(TYPE_LABELS)
        .map(([k, v]) => `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${v}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Building</span><select name="building"><option value="">All buildings</option></select></label>
      <label class="field"><span>Group size</span><select name="minCapacity"><option value="">Any</option>${[2, 4, 6, 10, 20, 40]
        .map((n) => `<option value="${n}" ${String(filters.minCapacity) === String(n) ? 'selected' : ''}>${n}+</option>`)
        .join('')}</select></label>
      <label class="check"><input type="checkbox" name="freeNow" ${filters.freeNow ? 'checked' : ''}> Free right now</label>
    </form>
    <div id="results" aria-live="polite">${loading('Finding spaces...')}</div>`;
  applyBars(el);

  const form = el.querySelector('#filters');
  const results = el.querySelector('#results');
  let requestId = 0;

  async function load() {
    const id = ++requestId;
    results.innerHTML = loading('Finding spaces...');
    try {
      const data = await api(`/resources${qs({ q: filters.q, type: filters.type, building: filters.building, minCapacity: filters.minCapacity })}`);
      if (!isCurrent() || id !== requestId) return;
      const sel = form.building;
      if (sel.options.length === 1) {
        sel.insertAdjacentHTML('beforeend', data.buildings.map((b) => `<option ${filters.building === b ? 'selected' : ''}>${esc(b)}</option>`).join(''));
      }
      const items = filters.freeNow ? data.items.filter((r) => r.freeNow) : data.items;
      const hasFilters = filters.q || filters.type || filters.building || filters.minCapacity || filters.freeNow;
      results.innerHTML = items.length
        ? `<p class="muted small">${items.length} ${items.length === 1 ? 'space' : 'spaces'}</p><div class="resource-grid">${items.map(card).join('')}</div>`
        : emptyState(
            'No spaces match',
            hasFilters ? 'Try removing a filter or searching for something else.' : 'No spaces have been set up yet.',
            hasFilters ? '<button class="btn" type="button" data-clear>Clear filters</button>' : '',
          );
      results.querySelector('[data-clear]')?.addEventListener('click', () => {
        Object.assign(filters, { q: '', type: '', building: '', minCapacity: '', freeNow: false });
        form.reset();
        form.q.value = '';
        load();
      });
    } catch (err) {
      if (!isCurrent() || id !== requestId) return;
      results.innerHTML = errorState(err);
      results.querySelector('[data-retry]').addEventListener('click', load);
    }
  }

  const sync = () => {
    filters.q = form.q.value.trim();
    filters.type = form.type.value;
    filters.building = form.building.value;
    filters.minCapacity = form.minCapacity.value;
    filters.freeNow = form.freeNow.checked;
  };
  form.addEventListener('input', debounce(() => {
    sync();
    load();
  }, 250));
  form.addEventListener('submit', (e) => e.preventDefault());
  await load();
}
