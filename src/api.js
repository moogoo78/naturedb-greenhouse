// Thin client for naturedb's general API. Auth is the JWT cookie set by
// naturedb's /admin/login, so every request is sent with credentials.

const BASE = (import.meta.env.VITE_NATUREDB_BASE || '').replace(/\/$/, '');

export class AuthError extends Error {}

function url(path, params = {}) {
  const u = new URL(BASE + path, window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  return u.toString();
}

export async function get(path, params) {
  const res = await fetch(url(path, params), { credentials: 'include' });
  // flask-jwt-extended: 401 = no/expired token, 422 = malformed token
  if (res.status === 401 || res.status === 422) throw new AuthError('login required');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.msg || `${res.status} ${res.statusText}`);
  return body;
}

export function loginUrl() {
  // same origin (dev proxy): a relative next; otherwise naturedb checks the
  // absolute URL against its CORS_ALLOWED_ORIGINS
  const here = window.location;
  const next = BASE ? here.href : here.pathname + here.search + here.hash;
  return url('/admin/login', { next });
}

// naturedb clears both login cookies (session + JWT), then shows its login
// page, which returns to this client's start page
export function logoutUrl() {
  const here = window.location;
  const next = BASE ? here.origin + here.pathname : here.pathname;
  return url('/admin/logout', { next });
}

export const exportUrl = (filter, format, sort) => url('/api/v1/units/export', { filter, format, sort });

export const recordUrl = (entityKey) => url(`/admin/records/${entityKey}`);

// a unit's public specimen page on naturedb (detail_path from the unit API)
export const publicUrl = (path) => (path ? url(path) : '');
