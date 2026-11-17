// Site-wide settings. Edit these, then redeploy (`forge deploy`).

// Confluence group whose members can approve, reject, publish and retire documents.
// Create this group in Confluence admin (Settings > User management > Groups) before use.
export const APPROVER_GROUP = 'doc-approvers';

// ISO-style segregation of duties: the person who submitted a revision for
// review cannot also approve it.
export const REQUIRE_INDEPENDENT_APPROVAL = true;

// When a published document is next due for review.
export const REVIEW_PERIOD_MONTHS = 12;

// Document types and the prefix used for their document numbers (e.g. SOP-001).
export const DOC_TYPES = [
  { value: 'SOP', label: 'Standard Operating Procedure', prefix: 'SOP' },
  { value: 'SAF', label: 'Safety Procedure', prefix: 'SAF' },
  { value: 'POL', label: 'Policy', prefix: 'POL' },
];

// Lock approved/published pages so only the approver group can edit them.
export const LOCK_APPROVED_PAGES = true;
