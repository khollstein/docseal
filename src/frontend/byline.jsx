import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  User,
  Lozenge,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { formatDate, formatDateTime, StatusLozenge } from './common.jsx';

const EVENT_LABEL = {
  registered: 'Brought under document control',
  submit: 'Submitted for review',
  withdraw: 'Withdrawn from review',
  approve: 'Approved',
  reject: 'Rejected',
  publish: 'Published',
  revise: 'New revision started',
  retire: 'Retired',
  edited_after_approval: 'Edited after approval (returned to Draft)',
  notification_failed: 'Notification could not be sent',
};

const LOCK_LABEL = {
  locked: 'page locked',
  unlocked: 'page unlocked',
  lock_failed: 'page lock FAILED',
  unlock_failed: 'page unlock failed',
};

function Field({ label, children }) {
  return (
    <Inline space="space.100" alignBlock="center">
      <Text weight="semibold">{label}:</Text>
      {children}
    </Inline>
  );
}

function Register({ docTypes, onDone }) {
  const [type, setType] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await invoke('register', { type: type?.value });
    setBusy(false);
    if (res?.error) setError(res.error);
    else onDone();
  };
  return (
    <Stack space="space.200">
      <Text>This page is not a controlled document. Bring it under control to give it a document number, an approval workflow and an audit trail.</Text>
      <Label labelFor="doc-type">Document type</Label>
      <Select
        id="doc-type"
        options={docTypes.map((t) => ({ label: `${t.label} (${t.prefix})`, value: t.value }))}
        value={type}
        onChange={setType}
      />
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      <Box>
        <Button appearance="primary" isDisabled={!type || busy} onClick={submit}>
          Make controlled document
        </Button>
      </Box>
    </Stack>
  );
}

function Actions({ actions, approvers, approverGroup, onDone }) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [reviewer, setReviewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const textField = (action) => action.requires.find((f) => f !== 'reviewerId');
  const needsReviewer = (action) => action.requires.includes('reviewerId');

  const run = async (action) => {
    setBusy(true);
    setMessage(null);
    const field = textField(action);
    const res = await invoke('act', {
      action: action.name,
      ...(field ? { [field]: text } : {}),
      ...(needsReviewer(action) ? { reviewerId: reviewer?.value } : {}),
    });
    setBusy(false);
    if (res?.error) return setMessage({ appearance: 'error', text: res.error });
    const warnings = [];
    if (res?.lock === 'lock_failed') warnings.push('The page could not be locked. Check the app has permission to set restrictions in this space.');
    if (res?.notified === false) warnings.push('The notification comment could not be posted, so let them know directly.');
    if (warnings.length) setMessage({ appearance: 'warning', text: `Done, but: ${warnings.join(' ')}` });
    setPending(null);
    setText('');
    setReviewer(null);
    onDone();
  };

  const start = (action) => {
    setMessage(null);
    if (action.requires.length) {
      setPending(action);
      setText('');
      setReviewer(null);
    } else {
      run(action);
    }
  };

  const ready = (action) =>
    (!textField(action) || text.trim()) && (!needsReviewer(action) || reviewer);

  if (!actions.length) return <Text>No actions available to you at this stage.</Text>;

  return (
    <Stack space="space.150">
      {message && <SectionMessage appearance={message.appearance}><Text>{message.text}</Text></SectionMessage>}
      {pending ? (
        <Stack space="space.100">
          {needsReviewer(pending) && (
            <Stack space="space.050">
              <Label labelFor="reviewer-input">Approver</Label>
              {approvers.length ? (
                <Select
                  id="reviewer-input"
                  options={approvers.map((a) => ({ label: a.displayName || a.accountId, value: a.accountId }))}
                  value={reviewer}
                  onChange={setReviewer}
                  placeholder="Choose who will approve this revision"
                />
              ) : (
                <SectionMessage appearance="warning">
                  <Text>No one else is in the “{approverGroup}” group. Add an approver in Confluence admin first.</Text>
                </SectionMessage>
              )}
            </Stack>
          )}
          <Label labelFor="action-input">
            {textField(pending) === 'changeSummary' ? 'What changed in this revision?' : `Reason (${pending.label.toLowerCase()})`}
          </Label>
          <TextArea id="action-input" value={text} onChange={(e) => setText(e.target.value)} />
          <ButtonGroup>
            <Button appearance="primary" isDisabled={!ready(pending) || busy} onClick={() => run(pending)}>
              {pending.label}
            </Button>
            <Button appearance="subtle" onClick={() => setPending(null)}>Cancel</Button>
          </ButtonGroup>
        </Stack>
      ) : (
        <ButtonGroup>
          {actions.map((a) => (
            <Button
              key={a.name}
              isDisabled={busy}
              appearance={['approve', 'submit', 'publish'].includes(a.name) ? 'primary' : a.name === 'retire' || a.name === 'reject' ? 'warning' : 'default'}
              onClick={() => start(a)}
            >
              {a.label}
            </Button>
          ))}
        </ButtonGroup>
      )}
    </Stack>
  );
}

function Status({ state, onChange }) {
  const { doc, actions, actor, approverGroup, approvers } = state;
  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center">
        <Heading size="small">{doc.docNumber}</Heading>
        <StatusLozenge status={doc.status} />
        {doc.revision > 0 && <Lozenge>Rev {doc.revision}</Lozenge>}
      </Inline>
      {doc.flag === 'edited_after_approval' && (
        <SectionMessage appearance="warning" title="Edited after approval">
          <Text>This page was changed after it was approved, so it has been returned to Draft. Submit it for review to re-approve.</Text>
        </SectionMessage>
      )}
      {doc.overdue && (
        <SectionMessage appearance="warning" title="Review overdue">
          <Text>This document was due for review on {formatDate(doc.nextReviewDue)}.</Text>
        </SectionMessage>
      )}
      <Stack space="space.050">
        <Field label="Owner"><User accountId={doc.ownerId} /></Field>
        {doc.status === 'in_review' && doc.submittedBy && (
          <Field label="Submitted by"><User accountId={doc.submittedBy} /></Field>
        )}
        {doc.status === 'in_review' && doc.reviewerId && (
          <Field label="Approver"><User accountId={doc.reviewerId} /></Field>
        )}
        {doc.pendingChangeSummary && <Field label="Proposed change"><Text>{doc.pendingChangeSummary}</Text></Field>}
        {doc.approvedBy && (
          <Field label={`Rev ${doc.revision} approved`}>
            <User accountId={doc.approvedBy} />
            <Text>{formatDate(doc.approvedAt)}</Text>
          </Field>
        )}
        {doc.changeSummary && <Field label="Change summary"><Text>{doc.changeSummary}</Text></Field>}
        {doc.effectiveDate && <Field label="Effective"><Text>{formatDate(doc.effectiveDate)}</Text></Field>}
        {doc.nextReviewDue && <Field label="Next review"><Text>{formatDate(doc.nextReviewDue)}</Text></Field>}
      </Stack>
      <Actions actions={actions} approvers={approvers || []} approverGroup={approverGroup} onDone={onChange} />
      {!actor.isApprover && (
        <Text size="small" color="color.text.subtlest">Approvals are limited to the “{approverGroup}” group.</Text>
      )}
    </Stack>
  );
}

function History() {
  const [data, setData] = useState(null);
  useEffect(() => {
    invoke('getAudit').then(setData);
  }, []);
  if (!data) return <Spinner />;
  if (data.error) return <SectionMessage appearance="error"><Text>{data.error}</Text></SectionMessage>;
  const { events, verification } = data;
  return (
    <Stack space="space.200">
      {verification.ok ? (
        <SectionMessage appearance="success">
          <Text>Audit trail verified: {verification.count} events, hash chain intact.</Text>
        </SectionMessage>
      ) : (
        <SectionMessage appearance="error" title="Audit trail integrity check failed">
          <Text>Problem at event {verification.brokenAt}: {verification.reason}.</Text>
        </SectionMessage>
      )}
      {[...events].reverse().map((e) => (
        <Stack key={e.seq} space="space.025">
          <Inline space="space.100" alignBlock="center">
            <Text weight="semibold">{EVENT_LABEL[e.type] || e.type}</Text>
            {e.data?.revision > 0 && ['approve', 'publish'].includes(e.type) && <Lozenge>Rev {e.data.revision}</Lozenge>}
          </Inline>
          <Inline space="space.100" alignBlock="center">
            {e.actor ? <User accountId={e.actor} /> : <Text>System</Text>}
            <Text color="color.text.subtle">{formatDateTime(e.at)}</Text>
            {e.data?.pageVersion && <Text color="color.text.subtle">· page v{e.data.pageVersion}</Text>}
            {e.data?.lock && <Text color="color.text.subtle">· {LOCK_LABEL[e.data.lock]}</Text>}
          </Inline>
          {e.data?.reviewerId && (
            <Inline space="space.100" alignBlock="center">
              <Text>Approver assigned:</Text>
              <User accountId={e.data.reviewerId} />
            </Inline>
          )}
          {e.data?.changeSummary && <Text>Change: {e.data.changeSummary}</Text>}
          {e.data?.comment && <Text>Comment: {e.data.comment}</Text>}
        </Stack>
      ))}
    </Stack>
  );
}

function App() {
  const [state, setState] = useState(null);
  const load = () => invoke('getState').then(setState);
  useEffect(() => {
    load();
  }, []);

  if (!state) return <Spinner />;
  if (state.error) return <SectionMessage appearance="error"><Text>{state.error}</Text></SectionMessage>;
  if (!state.doc) return <Register docTypes={state.docTypes} onDone={load} />;

  return (
    <Tabs id="docseal-tabs">
      <TabList>
        <Tab>Status</Tab>
        <Tab>History</Tab>
      </TabList>
      <TabPanel>
        <Box paddingBlock="space.200"><Status state={state} onChange={load} /></Box>
      </TabPanel>
      <TabPanel>
        <Box paddingBlock="space.200"><History key={state.doc.auditSeq} /></Box>
      </TabPanel>
    </Tabs>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
