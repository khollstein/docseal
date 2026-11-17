import Resolver from '@forge/resolver';
import {
  APPROVER_GROUP,
  DOC_TYPES,
  LOCK_APPROVED_PAGES,
  REQUIRE_INDEPENDENT_APPROVAL,
  REVIEW_PERIOD_MONTHS,
} from './config.js';
import {
  ACTIONS,
  applyAction,
  availableActions,
  isLockedStatus,
  isReviewOverdue,
  markEditedOutsideWorkflow,
  STATUS,
  STATUS_LABEL,
  WorkflowError,
} from './workflow.js';
import { verifyChain } from './audit.js';
import { appendAudit, claimDocNumber, getAudit, getDoc, listDocs, saveDoc } from './store.js';
import { getPage, isInGroup, lockPage, unlockPage } from './confluence.js';

const resolver = new Resolver();
const wfOpts = { requireIndependentApproval: REQUIRE_INDEPENDENT_APPROVAL };

// Always take the page and user from Forge's signed context, never from the browser.
function pageIdFrom(context) {
  const id = context?.extension?.content?.id;
  if (!id) throw new WorkflowError('No page in context.');
  return String(id);
}

async function actorFrom(context) {
  const accountId = context.accountId;
  return { accountId, isApprover: await isInGroup(accountId, APPROVER_GROUP) };
}

// Turn expected errors into a message the UI can show.
function handled(fn) {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof WorkflowError) return { error: err.message };
      console.error(err);
      return { error: 'Something went wrong. Check the app logs (forge logs).' };
    }
  };
}

function describeActions(doc, actor) {
  return availableActions(doc, actor, wfOpts).map((name) => ({
    name,
    label: ACTIONS[name].label,
    requires: ACTIONS[name].requires || [],
  }));
}

resolver.define(
  'getState',
  handled(async ({ context }) => {
    const pageId = pageIdFrom(context);
    const [doc, actor] = await Promise.all([getDoc(pageId), actorFrom(context)]);
    return {
      doc: doc ? { ...doc, overdue: isReviewOverdue(doc) } : null,
      actor,
      actions: describeActions(doc, actor),
      docTypes: DOC_TYPES,
      approverGroup: APPROVER_GROUP,
    };
  }),
);

resolver.define(
  'register',
  handled(async ({ payload, context }) => {
    const pageId = pageIdFrom(context);
    if (await getDoc(pageId)) throw new WorkflowError('This page is already a controlled document.');
    const type = DOC_TYPES.find((t) => t.value === payload?.type);
    if (!type) throw new WorkflowError('Choose a document type.');

    const page = await getPage(pageId);
    const now = new Date().toISOString();
    let doc = {
      pageId,
      spaceKey: context.extension?.space?.key ?? null,
      title: page.title,
      url: page.url,
      type: type.value,
      docNumber: await claimDocNumber(type.prefix),
      status: STATUS.DRAFT,
      revision: 0,
      ownerId: context.accountId,
      createdAt: now,
      updatedAt: now,
    };
    doc = await appendAudit(doc, 'registered', context.accountId, { docNumber: doc.docNumber, type: type.value, title: page.title }, now);
    await saveDoc(doc);
    return { ok: true };
  }),
);

resolver.define(
  'act',
  handled(async ({ payload, context }) => {
    const pageId = pageIdFrom(context);
    const name = payload?.action;
    const doc = await getDoc(pageId);
    if (!doc) throw new WorkflowError('This page is not a controlled document.');
    const actor = await actorFrom(context);
    const page = await getPage(pageId);
    const input = { changeSummary: payload?.changeSummary, comment: payload?.comment };
    const now = new Date().toISOString();

    let next = applyAction(doc, name, actor, input, {
      ...wfOpts,
      now,
      pageVersion: page.version,
      reviewPeriodMonths: REVIEW_PERIOD_MONTHS,
    });
    next.title = page.title;
    next.url = page.url ?? doc.url;

    // Lock on entering approved/published, unlock on leaving it.
    let lock = null;
    if (LOCK_APPROVED_PAGES && isLockedStatus(next.status) !== isLockedStatus(doc.status)) {
      const locking = isLockedStatus(next.status);
      try {
        await (locking ? lockPage : unlockPage)(pageId, APPROVER_GROUP);
        lock = locking ? 'locked' : 'unlocked';
      } catch (err) {
        console.error(err);
        lock = locking ? 'lock_failed' : 'unlock_failed';
      }
    }

    next = await appendAudit(
      next,
      name,
      actor.accountId,
      {
        from: doc.status,
        to: next.status,
        revision: next.revision,
        pageVersion: page.version,
        comment: input.comment?.trim() || null,
        changeSummary: input.changeSummary?.trim() || null,
        lock,
      },
      now,
    );
    await saveDoc(next);
    return { ok: true, lock };
  }),
);

resolver.define(
  'getAudit',
  handled(async ({ context }) => {
    const events = await getAudit(pageIdFrom(context));
    return { events, verification: verifyChain(events) };
  }),
);

resolver.define(
  'getRegister',
  handled(async () => {
    const now = new Date();
    const docs = (await listDocs())
      .map((d) => ({ ...d, overdue: isReviewOverdue(d, now) }))
      .sort((a, b) => a.docNumber.localeCompare(b.docNumber, undefined, { numeric: true }));
    return { docs, docTypes: DOC_TYPES, statusLabels: STATUS_LABEL };
  }),
);

export const handler = resolver.getDefinitions();

// Byline text, e.g. "SOP-004 · Rev 2 · Published".
export async function bylineProps(payload) {
  const ctx = payload?.context ?? payload;
  const id = ctx?.extension?.content?.id ?? ctx?.contentId;
  const doc = id ? await getDoc(String(id)) : null;
  if (!doc) return { title: 'Document control', tooltip: 'Not a controlled document' };
  const rev = doc.revision ? ` · Rev ${doc.revision}` : '';
  const overdue = isReviewOverdue(doc) ? ' · Review overdue' : '';
  return {
    title: `${doc.docNumber}${rev} · ${STATUS_LABEL[doc.status]}${overdue}`,
    tooltip: doc.flag === 'edited_after_approval' ? 'Edited after approval: needs re-approval' : 'Document control',
  };
}

// Safety net: if an approved/published page is edited anyway, send it back to Draft
// and record it, so an unapproved change can never sit under an "Approved" status.
export async function onPageUpdated(event) {
  const pageId = event?.content?.id;
  if (!pageId) return;
  const doc = await getDoc(String(pageId));
  if (!doc || !isLockedStatus(doc.status)) return;

  const page = await getPage(String(pageId));
  if (doc.approvedPageVersion == null || page.version == null || page.version <= doc.approvedPageVersion) return;

  const now = new Date().toISOString();
  let lock = null;
  if (LOCK_APPROVED_PAGES) {
    try {
      await unlockPage(String(pageId), APPROVER_GROUP);
      lock = 'unlocked';
    } catch (err) {
      console.error(err);
      lock = 'unlock_failed';
    }
  }
  let next = markEditedOutsideWorkflow({ ...doc, title: page.title }, now);
  next = await appendAudit(
    next,
    'edited_after_approval',
    event.atlassianId ?? null,
    { from: doc.status, to: next.status, approvedPageVersion: doc.approvedPageVersion, pageVersion: page.version, lock },
    now,
  );
  await saveDoc(next);
}
