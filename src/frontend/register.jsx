import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box,
  DynamicTable,
  Heading,
  Inline,
  Link,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  User,
  Button,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { formatDate, StatusLozenge } from './common.jsx';

const ALL = { label: 'All', value: '' };

function App() {
  const [data, setData] = useState(null);
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState('');
  const [hideObsolete, setHideObsolete] = useState(true);

  useEffect(() => {
    invoke('getRegister').then(setData);
  }, []);

  const docs = useMemo(() => {
    if (!data?.docs) return [];
    const q = search.trim().toLowerCase();
    return data.docs.filter(
      (d) =>
        (!type.value || d.type === type.value) &&
        (status.value ? (status.value === 'overdue' ? d.overdue : d.status === status.value) : !(hideObsolete && d.status === 'obsolete')) &&
        (!q || d.docNumber.toLowerCase().includes(q) || (d.title || '').toLowerCase().includes(q)),
    );
  }, [data, type, status, search, hideObsolete]);

  if (!data) return <Spinner />;
  if (data.error) return <SectionMessage appearance="error"><Text>{data.error}</Text></SectionMessage>;

  const typeLabel = Object.fromEntries(data.docTypes.map((t) => [t.value, t.label]));
  const counts = data.docs.reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] || 0) + 1 }), {});
  const overdue = data.docs.filter((d) => d.overdue).length;

  const head = {
    cells: [
      { key: 'num', content: 'Doc no.', isSortable: true },
      { key: 'title', content: 'Title', isSortable: true },
      { key: 'type', content: 'Type', isSortable: true },
      { key: 'rev', content: 'Rev', isSortable: true },
      { key: 'status', content: 'Status', isSortable: true },
      { key: 'owner', content: 'Owner' },
      { key: 'approved', content: 'Approved by' },
      { key: 'effective', content: 'Effective', isSortable: true },
      { key: 'review', content: 'Next review', isSortable: true },
    ],
  };

  const rows = docs.map((d) => ({
    key: d.pageId,
    cells: [
      { key: d.docNumber, content: <Text weight="semibold">{d.docNumber}</Text> },
      { key: d.title, content: d.url ? <Link href={d.url}>{d.title}</Link> : <Text>{d.title}</Text> },
      { key: d.type, content: <Text>{typeLabel[d.type] || d.type}</Text> },
      { key: d.revision || 0, content: <Text>{d.revision || '—'}</Text> },
      { key: d.status, content: <StatusLozenge status={d.status} /> },
      { key: d.ownerId, content: <User accountId={d.ownerId} /> },
      { key: d.approvedBy || '', content: d.approvedBy ? <User accountId={d.approvedBy} /> : <Text>—</Text> },
      { key: d.effectiveDate || '', content: <Text>{formatDate(d.effectiveDate)}</Text> },
      {
        key: d.nextReviewDue || '',
        content: d.overdue ? (
          <Lozenge appearance="removed">Overdue {formatDate(d.nextReviewDue)}</Lozenge>
        ) : (
          <Text>{formatDate(d.nextReviewDue)}</Text>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.300">
      <Heading size="large">Document Register</Heading>
      <Inline space="space.200" shouldWrap>
        <Text>{data.docs.length} documents</Text>
        <Text>Published: {counts.published || 0}</Text>
        <Text>In review: {counts.in_review || 0}</Text>
        <Text>Draft: {counts.draft || 0}</Text>
        <Text>Obsolete: {counts.obsolete || 0}</Text>
        {overdue > 0 && <Lozenge appearance="removed">{overdue} overdue for review</Lozenge>}
      </Inline>
      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Box xcss={xcss({ width: '240px' })}>
          <Textfield placeholder="Search number or title" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Box>
        <Box xcss={xcss({ width: '240px' })}>
          <Select
            options={[ALL, ...data.docTypes.map((t) => ({ label: t.label, value: t.value }))]}
            value={type}
            onChange={(v) => setType(v || ALL)}
          />
        </Box>
        <Box xcss={xcss({ width: '200px' })}>
          <Select
            options={[
              ALL,
              ...Object.entries(data.statusLabels).map(([value, label]) => ({ label, value })),
              { label: 'Overdue for review', value: 'overdue' },
            ]}
            value={status}
            onChange={(v) => setStatus(v || ALL)}
          />
        </Box>
        {!status.value && (
          <Button appearance="subtle" onClick={() => setHideObsolete(!hideObsolete)}>
            {hideObsolete ? 'Show obsolete' : 'Hide obsolete'}
          </Button>
        )}
      </Inline>
      <DynamicTable
        head={head}
        rows={rows}
        rowsPerPage={50}
        emptyView={<Text>No documents match.</Text>}
      />
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
