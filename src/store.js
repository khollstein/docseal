// Forge key-value storage. Keys:
//   doc:<pageId>              document record
//   audit:<pageId>:<seq>      audit event (write-once)
//   docnum:<SOP-001>          claimed document number (write-once)
//   counter:<prefix>          last issued number (hint only)
import { kvs, WhereConditions } from '@forge/kvs';
import { buildEvent, GENESIS_HASH } from './audit.js';
import { formatDocNumber, WorkflowError } from './workflow.js';

const docKey = (pageId) => `doc:${pageId}`;
const auditKey = (pageId, seq) => `audit:${pageId}:${String(seq).padStart(6, '0')}`;

export const getDoc = (pageId) => kvs.get(docKey(pageId));
export const saveDoc = (doc) => kvs.set(docKey(doc.pageId), doc);

async function queryAll(prefix) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export const listDocs = () => queryAll('doc:');

export async function getAudit(pageId) {
  const events = await queryAll(`audit:${pageId}:`);
  return events.sort((a, b) => a.seq - b.seq);
}

// Write a key only if it doesn't exist yet. Returns false if it already exists.
async function setOnce(key, value) {
  try {
    await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch (err) {
    if ((await kvs.get(key)) !== undefined) return false;
    throw err;
  }
}

/**
 * Append an audit event for a document. The write-once audit key doubles as an
 * optimistic lock: if two people act at the same moment, the second one fails.
 * Returns the doc with its chain pointer advanced (caller must save it).
 */
export async function appendAudit(doc, type, actor, data, at = new Date().toISOString()) {
  const seq = (doc.auditSeq || 0) + 1;
  const event = buildEvent({ pageId: doc.pageId, seq, type, actor, at, data, prevHash: doc.lastHash || GENESIS_HASH });
  if (!(await setOnce(auditKey(doc.pageId, seq), event))) {
    throw new WorkflowError('Someone else just changed this document. Refresh and try again.');
  }
  return { ...doc, auditSeq: seq, lastHash: event.hash };
}

/** Reserve the next free document number for a prefix, e.g. SOP-007. */
export async function claimDocNumber(prefix) {
  let n = ((await kvs.get(`counter:${prefix}`)) || 0) + 1;
  for (let attempts = 0; attempts < 50; attempts++, n++) {
    const number = formatDocNumber(prefix, n);
    if (await setOnce(`docnum:${number}`, { claimedAt: new Date().toISOString() })) {
      await kvs.set(`counter:${prefix}`, n);
      return number;
    }
  }
  throw new Error(`Could not allocate a ${prefix} document number`);
}
