// Pure workflow rules: no Forge or network calls, so it can be unit tested.

export const STATUS = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  OBSOLETE: 'obsolete',
};

export const STATUS_LABEL = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
  obsolete: 'Obsolete',
};

export class WorkflowError extends Error {}

const FIELD_LABEL = { changeSummary: 'A change summary', comment: 'A comment', reviewerId: 'An approver' };

// Each action: allowed source statuses, target status, who may do it, and required input.
export const ACTIONS = {
  submit: { from: ['draft'], to: 'in_review', who: 'editor', requires: ['changeSummary', 'reviewerId'], label: 'Submit for review' },
  withdraw: { from: ['in_review'], to: 'draft', who: 'submitterOrOwner', label: 'Withdraw' },
  approve: { from: ['in_review'], to: 'approved', who: 'assignedReviewer', label: 'Approve' },
  reject: { from: ['in_review'], to: 'draft', who: 'assignedReviewer', requires: ['comment'], label: 'Reject' },
  publish: { from: ['approved'], to: 'published', who: 'approverOrOwner', label: 'Publish' },
  revise: { from: ['approved', 'published'], to: 'draft', who: 'approverOrOwner', label: 'Start new revision' },
  retire: { from: ['draft', 'approved', 'published'], to: 'obsolete', who: 'approver', requires: ['comment'], label: 'Retire (obsolete)' },
};

/**
 * Which actions can this actor take on this document right now?
 * @param doc document record (or null if not controlled)
 * @param actor { accountId, isApprover }
 * @param opts { requireIndependentApproval }
 */
export function availableActions(doc, actor, opts = {}) {
  if (!doc) return [];
  return Object.keys(ACTIONS).filter((name) => {
    try {
      checkAction(doc, name, actor, {}, { ...opts, skipInput: true });
      return true;
    } catch {
      return false;
    }
  });
}

export function checkAction(doc, name, actor, input = {}, opts = {}) {
  const action = ACTIONS[name];
  if (!action) throw new WorkflowError(`Unknown action: ${name}`);
  if (!action.from.includes(doc.status)) {
    throw new WorkflowError(`Cannot ${action.label.toLowerCase()} a document that is ${STATUS_LABEL[doc.status]}.`);
  }
  const isOwner = doc.ownerId === actor.accountId;
  const isSubmitter = doc.submittedBy === actor.accountId;
  const allowed = {
    editor: true,
    approver: actor.isApprover,
    // The named reviewer only. Documents submitted before reviewers were named fall back to any approver.
    assignedReviewer: actor.isApprover && (!doc.reviewerId || doc.reviewerId === actor.accountId),
    approverOrOwner: actor.isApprover || isOwner,
    submitterOrOwner: isSubmitter || isOwner,
  }[action.who];
  if (!allowed) {
    if (action.who === 'assignedReviewer' && actor.isApprover) {
      throw new WorkflowError('This revision is assigned to another approver.');
    }
    throw new WorkflowError(`You are not permitted to ${action.label.toLowerCase()} this document.`);
  }

  if (name === 'approve' && opts.requireIndependentApproval && isSubmitter) {
    throw new WorkflowError('You submitted this revision, so someone else must approve it.');
  }
  if (!opts.skipInput) {
    for (const field of action.requires || []) {
      if (!input[field] || !String(input[field]).trim()) {
        throw new WorkflowError(`${FIELD_LABEL[field]} is required.`);
      }
    }
    if (name === 'submit' && opts.requireIndependentApproval && input.reviewerId === actor.accountId) {
      throw new WorkflowError('Choose someone other than yourself to approve this revision.');
    }
  }
  return action;
}

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/**
 * Apply an action and return the new document record (does not mutate input).
 * @param ctx { now, pageVersion, reviewPeriodMonths, requireIndependentApproval }
 */
export function applyAction(doc, name, actor, input = {}, ctx = {}) {
  const action = checkAction(doc, name, actor, input, ctx);
  const now = ctx.now || new Date().toISOString();
  const next = { ...doc, status: action.to, updatedAt: now, flag: null };

  switch (name) {
    case 'submit':
      next.submittedBy = actor.accountId;
      next.submittedAt = now;
      next.pendingChangeSummary = input.changeSummary.trim();
      next.reviewerId = input.reviewerId;
      break;
    case 'withdraw':
    case 'reject':
      next.submittedBy = null;
      next.submittedAt = null;
      next.reviewerId = null;
      break;
    case 'approve':
      next.revision = (doc.revision || 0) + 1;
      next.approvedBy = actor.accountId;
      next.approvedAt = now;
      next.approvedPageVersion = ctx.pageVersion ?? null;
      next.changeSummary = doc.pendingChangeSummary || null;
      next.pendingChangeSummary = null;
      next.reviewerId = null;
      break;
    case 'publish':
      next.publishedBy = actor.accountId;
      next.effectiveDate = now;
      next.nextReviewDue = addMonths(now, ctx.reviewPeriodMonths ?? 12);
      break;
    case 'revise':
      next.submittedBy = null;
      next.submittedAt = null;
      next.reviewerId = null;
      break;
    case 'retire':
      next.retiredAt = now;
      next.retiredBy = actor.accountId;
      next.nextReviewDue = null;
      break;
  }
  return next;
}

/** Called when the page is edited outside the workflow while approved/published. */
export function markEditedOutsideWorkflow(doc, now = new Date().toISOString()) {
  return { ...doc, status: STATUS.DRAFT, updatedAt: now, flag: 'edited_after_approval' };
}

export function isLockedStatus(status) {
  return status === STATUS.APPROVED || status === STATUS.PUBLISHED;
}

export function isReviewOverdue(doc, now = new Date()) {
  return doc.status === STATUS.PUBLISHED && !!doc.nextReviewDue && new Date(doc.nextReviewDue) < now;
}

export function formatDocNumber(prefix, n) {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
