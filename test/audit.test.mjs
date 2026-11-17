import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent, canonical, GENESIS_HASH, verifyChain } from '../src/audit.js';

function chain(n) {
  const events = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e = buildEvent({ pageId: '42', seq, type: 'submit', actor: 'a', at: `2026-01-0${seq}T00:00:00Z`, data: { comment: `c${seq}` }, prevHash: prev });
    events.push(e);
    prev = e.hash;
  }
  return events;
}

test('an untouched chain verifies', () => {
  assert.deepEqual(verifyChain(chain(4)), { ok: true, count: 4 });
  assert.deepEqual(verifyChain([]), { ok: true, count: 0 });
});

test('altering an event is detected', () => {
  const events = chain(4);
  events[1] = { ...events[1], data: { comment: 'rewritten' } };
  assert.deepEqual(verifyChain(events), { ok: false, count: 4, brokenAt: 2, reason: 'event contents altered' });
});

test('altering an event and recomputing its hash breaks the next link', () => {
  const events = chain(4);
  events[1] = buildEvent({ ...events[1], actor: 'impostor' });
  const r = verifyChain(events);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 3);
});

test('deleting an event is detected', () => {
  const events = chain(4);
  events.splice(2, 1);
  assert.equal(verifyChain(events).ok, false);
});

test('hash does not depend on key order', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
});
