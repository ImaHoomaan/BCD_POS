import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword, TEST_PARAMS } = require('../../server/auth/passwords');
const { login, LOCK_MS } = require('../../server/auth/login');
const { createSession, resolveSession, IDLE_TIMEOUT_MS } = require('../../server/auth/sessions');
const { AuthFailed, LoginLocked, ValidationError } = require('../../server/lib/errors');
const { makeDb, addUsers, makeClock } = require('../helpers');
const users = require('../../server/db/repos/users');

describe('password hashing', () => {
  // Feature: restaurant-pos-system, Property 18: Password hashing
  it('is salted, one-way and verifiable', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 12, maxLength: 40 }), fc.string({ minLength: 12, maxLength: 40 }), (pw, other) => {
        const a = hashPassword(pw, { params: TEST_PARAMS });
        const b = hashPassword(pw, { params: TEST_PARAMS });
        expect(a).not.toBe(pw);
        expect(a.includes(pw)).toBe(false);
        expect(a).not.toBe(b); // random salt
        expect(verifyPassword(pw, a)).toBe(true);
        if (other !== pw) expect(verifyPassword(other, a)).toBe(false);
      }),
      { numRuns: 60 }
    );
  });

  it('never stores seeded passwords in plain text', () => {
    const db = makeDb({ seed: true });
    for (const row of db.prepare('SELECT password_hash h FROM users').all()) {
      expect(row.h.startsWith('scrypt$')).toBe(true);
      for (const pw of ['Owner@123', 'Cashier1@123', 'Cashier2@123', 'Cashier3@123']) expect(row.h.includes(pw)).toBe(false);
    }
    db.close();
  });
});

// ---- Property 19: login throttling against a reference model ---------------------------------
describe('login throttling', () => {
  // Feature: restaurant-pos-system, Property 19: Login throttling model
  it('behaves like the reference model for any sequence of attempts and clock moves', () => {
    const event = fc.oneof(
      fc.record({
        type: fc.constant('attempt'),
        user: fc.constantFrom('Cashier 1', 'cashier 1 ', 'ghost'),
        pw: fc.constantFrom('x', 'x', 'wrong', ''),
      }),
      fc.record({ type: fc.constant('advance'), ms: fc.constantFrom(1000, 60_000, 4 * 60_000, 5 * 60_000, 6 * 60_000) })
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 30 }), (events) => {
        const db = makeDb();
        addUsers(db);
        const clock = makeClock();
        const model = new Map(); // key -> { count, lockedUntil (ms) }
        const genericMessages = new Set();

        for (const ev of events) {
          if (ev.type === 'advance') {
            clock.advance(ev.ms);
            continue;
          }
          const now = clock().getTime();
          const key = ev.user.trim().toLowerCase();
          let expected;
          const m = model.get(key) || { count: 0, lockedUntil: null };
          if (ev.pw === '') {
            expected = 'validation'; // empty field: not counted
          } else if (m.lockedUntil !== null && now < m.lockedUntil) {
            expected = 'locked';
          } else {
            if (m.lockedUntil !== null) m.count = 0; // lock expired
            const good = key === 'cashier 1' && ev.pw === 'x';
            if (good) {
              model.set(key, { count: 0, lockedUntil: null });
              expected = 'session';
            } else {
              m.count += 1;
              m.lockedUntil = m.count >= 5 ? now + LOCK_MS : null;
              model.set(key, m);
              expected = 'failed';
            }
          }

          let actual;
          try {
            const r = login(db, { username: ev.user, password: ev.pw, draftJson: '{}' }, clock());
            expect(r.token).toBeTruthy();
            actual = 'session';
          } catch (e) {
            if (e instanceof ValidationError) actual = 'validation';
            else if (e instanceof LoginLocked) actual = 'locked';
            else if (e instanceof AuthFailed) {
              actual = 'failed';
              genericMessages.add(e.message); // identical for wrong user and wrong password
            } else throw e;
          }
          expect(actual, JSON.stringify(ev)).toBe(expected);
        }
        expect(genericMessages.size).toBeLessThanOrEqual(1);
        db.close();
      }),
      { numRuns: 80 }
    );
  });

  it('a locked username rejects even the correct password, then recovers after 5 minutes', () => {
    const db = makeDb();
    addUsers(db);
    const clock = makeClock();
    for (let i = 0; i < 5; i++) expect(() => login(db, { username: 'Cashier 1', password: 'bad', draftJson: '{}' }, clock())).toThrow(AuthFailed);
    expect(() => login(db, { username: 'Cashier 1', password: 'x', draftJson: '{}' }, clock())).toThrow(LoginLocked);
    clock.advance(LOCK_MS + 1000);
    expect(login(db, { username: 'Cashier 1', password: 'x', draftJson: '{}' }, clock()).user.role).toBe('cashier');
    db.close();
  });

  it('unknown usernames are throttled like real ones', () => {
    const db = makeDb();
    addUsers(db);
    const clock = makeClock();
    for (let i = 0; i < 5; i++) expect(() => login(db, { username: 'nobody', password: 'bad', draftJson: '{}' }, clock())).toThrow(AuthFailed);
    expect(() => login(db, { username: 'nobody', password: 'bad', draftJson: '{}' }, clock())).toThrow(LoginLocked);
    db.close();
  });
});

describe('session idle expiry', () => {
  // Feature: restaurant-pos-system, Property 20: Session idle expiry
  it('is valid iff under 30 minutes since the last user activity; polling never extends it', () => {
    const step = fc.record({
      dt: fc.integer({ min: 0, max: 40 * 60 }).map((s) => s * 1000),
      background: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 25 }), (steps) => {
        const db = makeDb();
        addUsers(db);
        const clock = makeClock();
        const uid = users.findUserByUsername(db, 'Cashier 1').id;
        const { token } = createSession(db, uid, clock(), '{}');
        let last = clock().getTime();
        let alive = true;
        for (const s of steps) {
          clock.advance(s.dt);
          const now = clock().getTime();
          const expectValid = alive && now - last < IDLE_TIMEOUT_MS;
          const r = resolveSession(db, token, clock(), { touch: !s.background });
          expect(!!(r && r.principal)).toBe(expectValid);
          if (!expectValid) alive = false;
          else if (!s.background) last = now;
        }
        db.close();
      }),
      { numRuns: 100 }
    );
  });
});
