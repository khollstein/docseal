import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  availableActions,
  formatDocNumber,
  isReviewOverdue,
  markEditedOutsideWorkflow,
  WorkflowError,
} from '../src/workflow.js';

const owner = { accountId: 'owner', isApprover: false };
const approver = { accountId: 'approver', isApprover: true };
const approver2 = { accountId: 'approver2', isApprover: true };
const someone = { accountId: 'someone', isApprover: false };
const opts = { requireIndependentApproval: true, reviewPeriodMonths: 12 };

const draft = () => ({ pageId: '1', docNumber: 'SOP-001', status: 'draft', revision: 0, ownerId: 'owner' });

test('full happy path: draft → review → approved → published', () => {
  let d = applyAction(draft(), 'submit', owner, { changeSummary: 'Initial issue', reviewerId: 'approver' }, opts);
  assert.equal(d.status, 'in_review');
  assert.equal(d.submittedBy, 'owner');

  d = applyAction(d, 'approve', approver, {}, { ...opts, pageVersion: 7, now: '2026-01-10T00:00:00.000Z' });
  assert.equal(d.status, 'approved');
  assert.equal(d.revision, 1);
  assert.equal(d.approvedPageVersion, 7);
  assert.equal(d.changeSummary, 'Initial issue');

  d = applyAction(d, 'publish', owner, {}, { ...opts, now: '2026-01-15T00:00:00.000Z' });
  assert.equal(d.status, 'published');
  assert.equal(d.nextReviewDue, '2027-01-15T00:00:00.000Z');
});

test('revision number increments on each approval', () => {
  let d = { ...draft(), status: 'published', revision: 3 };
  d = applyAction(d, 'revise', owner, {}, opts);
  d = applyAction(d, 'submit', owner, { changeSummary: 'Update step 4', reviewerId: 'approver' }, opts);
  d = applyAction(d, 'approve', approver, {}, opts);
  assert.equal(d.revision, 4);
});

test('only approvers can approve', () => {
  const d = applyAction(draft(), 'submit', owner, { changeSummary: 'x', reviewerId: 'approver' }, opts);
  assert.throws(() => applyAction(d, 'approve', someone, {}, opts), WorkflowError);
});

test('submitter cannot approve their own revision', () => {
  const d = applyAction({ ...draft(), ownerId: 'approver' }, 'submit', approver, { changeSummary: 'x', reviewerId: 'approver2' }, opts);
  assert.throws(() => applyAction(d, 'approve', approver, {}, opts), WorkflowError);
  assert.equal(applyAction(d, 'approve', approver2, {}, opts).status, 'approved');
  // Older documents with no named approver: the independence rule still applies.
  const legacy = { ...d, reviewerId: null };
  assert.throws(() => applyAction(legacy, 'approve', approver, {}, opts), /someone else/);
  // Allowed when independence is switched off.
  assert.equal(applyAction(legacy, 'approve', approver, {}, { requireIndependentApproval: false }).status, 'approved');
});

test('submit needs a change summary; reject and retire need a comment', () => {
  assert.throws(() => applyAction(draft(), 'submit', owner, { changeSummary: '  ', reviewerId: 'approver' }, opts), /change summary/);
  const d = applyAction(draft(), 'submit', owner, { changeSummary: 'x', reviewerId: 'approver' }, opts);
  assert.throws(() => applyAction(d, 'reject', approver, {}, opts), /comment/);
  assert.equal(applyAction(d, 'reject', approver, { comment: 'Step 3 unclear' }, opts).status, 'draft');
  assert.throws(() => applyAction({ ...draft(), status: 'published' }, 'retire', approver, {}, opts), /comment/);
});

test('invalid transitions are refused', () => {
  assert.throws(() => applyAction(draft(), 'approve', approver, {}, opts), /Draft/);
  assert.throws(() => applyAction(draft(), 'publish', owner, {}, opts), WorkflowError);
  assert.throws(() => applyAction({ ...draft(), status: 'obsolete' }, 'revise', owner, {}, opts), WorkflowError);
});

test('availableActions reflects role and state', () => {
  const inReview = { ...draft(), status: 'in_review', submittedBy: 'owner', reviewerId: 'approver' };
  assert.deepEqual(availableActions(inReview, approver, opts).sort(), ['approve', 'reject']);
  assert.deepEqual(availableActions(inReview, owner, opts), ['withdraw']);
  assert.deepEqual(availableActions(inReview, someone, opts), []);
  assert.deepEqual(availableActions(draft(), someone, opts), ['submit']);
  assert.deepEqual(availableActions(null, owner, opts), []);
});

test('edit after approval returns the document to draft and flags it', () => {
  const d = markEditedOutsideWorkflow({ ...draft(), status: 'published' });
  assert.equal(d.status, 'draft');
  assert.equal(d.flag, 'edited_after_approval');
  // The flag clears on the next workflow action.
  assert.equal(applyAction(d, 'submit', owner, { changeSummary: 'x', reviewerId: 'approver' }, opts).flag, null);
});

test('review overdue only applies to published documents past their date', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  assert.equal(isReviewOverdue({ status: 'published', nextReviewDue: '2026-05-01T00:00:00Z' }, now), true);
  assert.equal(isReviewOverdue({ status: 'published', nextReviewDue: '2026-07-01T00:00:00Z' }, now), false);
  assert.equal(isReviewOverdue({ status: 'draft', nextReviewDue: '2026-05-01T00:00:00Z' }, now), false);
});

test('document numbers are zero-padded', () => {
  assert.equal(formatDocNumber('SOP', 7), 'SOP-007');
  assert.equal(formatDocNumber('POL', 1234), 'POL-1234');
});

test('only the named approver can approve or reject', () => {
  const d = applyAction(draft(), 'submit', owner, { changeSummary: 'x', reviewerId: 'approver' }, opts);
  assert.equal(d.reviewerId, 'approver');
  assert.throws(() => applyAction(d, 'approve', approver2, {}, opts), /assigned to another approver/);
  assert.throws(() => applyAction(d, 'reject', approver2, { comment: 'no' }, opts), /assigned to another approver/);
  assert.deepEqual(availableActions(d, approver2, opts), []);
  const approved = applyAction(d, 'approve', approver, {}, opts);
  assert.equal(approved.reviewerId, null);
  assert.equal(approved.approvedBy, 'approver');
});

test('submit needs an approver, and not yourself', () => {
  assert.throws(() => applyAction(draft(), 'submit', owner, { changeSummary: 'x' }, opts), /An approver is required/);
  assert.throws(() => applyAction(draft(), 'submit', approver, { changeSummary: 'x', reviewerId: 'approver' }, opts), /other than yourself/);
});

test('documents submitted before named approvers existed can be approved by any approver', () => {
  const legacy = { ...draft(), status: 'in_review', submittedBy: 'owner' };
  assert.equal(applyAction(legacy, 'approve', approver2, {}, opts).status, 'approved');
});

test('withdraw and reject clear the assigned approver', () => {
  const d = applyAction(draft(), 'submit', owner, { changeSummary: 'x', reviewerId: 'approver' }, opts);
  assert.equal(applyAction(d, 'withdraw', owner, {}, opts).reviewerId, null);
  assert.equal(applyAction(d, 'reject', approver, { comment: 'no' }, opts).reviewerId, null);
});
