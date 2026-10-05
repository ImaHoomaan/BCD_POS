// Thin fetch wrapper. It adds the CSRF header, flags background polling requests (which must
// not extend the idle timer) and turns server errors into ApiError objects.

let csrfToken = null;
let onUnauthorized = null;

export const setCsrfToken = (t) => {
  csrfToken = t;
};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', fields = null, detail = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.detail = detail;
  }
}

async function request(method, url, body, { background = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (background) headers['X-Background'] = '1';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Cannot reach the POS server.', { status: 0, code: 'network' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(e.message || `Request failed (${res.status})`, {
      status: res.status,
      code: e.code || 'error',
      fields: e.detail?.fields || null,
      detail: e.detail || null,
    });
    if (res.status === 401 && err.code !== 'auth_failed' && onUnauthorized) onUnauthorized(err);
    throw err;
  }
  return data;
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  put: (url, body = {}, opts) => request('PUT', url, body, opts),
  del: (url, opts) => request('DELETE', url, undefined, opts),
};
