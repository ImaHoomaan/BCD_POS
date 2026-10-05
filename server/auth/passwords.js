'use strict';

const crypto = require('node:crypto');

// Salted one-way hashing with scrypt (Req 2.2). Stored format:
//   scrypt$N$r$p$<salt base64>$<hash base64>
const DEFAULT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLen: 32 });
// Cheap parameters for tests only; never used by the application.
const TEST_PARAMS = Object.freeze({ N: 16, r: 1, p: 1, keyLen: 32 });

function hashPassword(password, { salt, params = DEFAULT_PARAMS } = {}) {
  const s = salt || crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), s, params.keyLen, { N: params.N, r: params.r, p: params.p });
  return ['scrypt', params.N, params.r, params.p, s.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used for unknown usernames so response time does not reveal whether an account exists.
let dummy;
function dummyVerify(password) {
  dummy = dummy || hashPassword('not-a-real-password');
  verifyPassword(password, dummy);
  return false;
}

module.exports = { DEFAULT_PARAMS, TEST_PARAMS, hashPassword, verifyPassword, dummyVerify };
