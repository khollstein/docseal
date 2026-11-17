import React from 'react';
import { Lozenge } from '@forge/react';

const APPEARANCE = {
  draft: 'default',
  in_review: 'inprogress',
  approved: 'new',
  published: 'success',
  obsolete: 'removed',
};

const LABEL = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
  obsolete: 'Obsolete',
};

export const StatusLozenge = ({ status }) => (
  <Lozenge appearance={APPEARANCE[status] || 'default'} isBold>
    {LABEL[status] || status}
  </Lozenge>
);

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
