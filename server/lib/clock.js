'use strict';

// Time is always injected (a Clock is a function returning a Date) so tests control it.
// Timestamps are stored as local-time text 'YYYY-MM-DD HH:MM:SS', which sorts correctly
// as a string and is compared with half-open ranges [start, endExclusive).

const systemClock = () => new Date();

const pad = (n, w = 2) => String(n).padStart(w, '0');

function formatLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocal(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(text);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
}

module.exports = { systemClock, formatLocal, formatDay, parseLocal, startOfDay, addDays };
