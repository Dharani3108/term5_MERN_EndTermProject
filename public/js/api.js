// Thin fetch wrapper: JSON in/out, anti-forgery header on writes and a
// typed error for every failure mode (network, HTTP, malformed response).
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
  };
  if (method !== 'GET') init.headers['X-Requested-With'] = 'fetch';
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (proxy error page, etc.)
  }

  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(res.status, e.code || `HTTP_${res.status}`, e.message || `Request failed (${res.status}).`, e.details);
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('slotwise:unauthorized'));
    }
    throw err;
  }
  if (data === null) throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unexpected response.');
  return data;
}
