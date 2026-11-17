// Hash-chained audit events. Each event includes the hash of the previous one,
// so any later edit, deletion or reordering of history is detectable.
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

// Stable JSON: object keys sorted so the hash never depends on key order.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function hashEvent({ pageId, seq, type, actor, at, data, prevHash }) {
  return createHash('sha256')
    .update(canonical({ pageId, seq, type, actor, at, data: data ?? null, prevHash }))
    .digest('hex');
}

export function buildEvent({ pageId, seq, type, actor, at, data, prevHash }) {
  const event = { pageId: String(pageId), seq, type, actor: actor ?? null, at, data: data ?? null, prevHash };
  return { ...event, hash: hashEvent(event) };
}

/** Verify an ordered list of events. Returns { ok, count, brokenAt?, reason? }. */
export function verifyChain(events) {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) return { ok: false, count: events.length, brokenAt: i + 1, reason: 'missing or out-of-order event' };
    if (e.prevHash !== prev) return { ok: false, count: events.length, brokenAt: e.seq, reason: 'chain link broken' };
    if (hashEvent(e) !== e.hash) return { ok: false, count: events.length, brokenAt: e.seq, reason: 'event contents altered' };
    prev = e.hash;
  }
  return { ok: true, count: events.length };
}
