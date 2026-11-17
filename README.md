# DocSeal: controlled documents for Confluence

An internal Forge app for SOPs, safety procedures and policies:

**Draft → In review → Approved → Published** (plus **Obsolete**), with document numbers, recorded approvals, a tamper-evident audit trail, page locking and a document register.

## What it does

- **Page byline (“Document control”).** Appears on every page. Click it to bring a page under control (choose SOP / Safety Procedure / Policy). The page gets a number like `SOP-004` and then shows its number, revision and status in the byline.
- **Workflow.**
  | Action | Who | Notes |
  |---|---|---|
  | Submit for review | Any editor | Change summary and a named approver (from the group) required |
  | Withdraw | Submitter or owner | |
  | Approve | The named approver | Not the person who submitted it (ISO segregation of duties). Bumps revision (Rev 1, 2, 3…) and **locks the page** to the approver group |
  | Reject | The named approver | Comment required |
  | Publish | Approver or owner | Sets effective date and next review date (+12 months) |
  | Start new revision | Approver or owner | Unlocks the page, back to Draft |
  | Retire | `doc-approvers` group | Reason required |
- **Notifications.** The app posts a page comment @mentioning the person who needs to act, so Confluence sends them its usual email and bell notification. It notifies the approver on submit and withdraw, the submitter on approve and reject, and the owner on publish, retire and edits after approval. If a comment can't be posted, the action still goes through, and History shows "Notification could not be sent".
- **Edit detection.** If an Approved/Published page is edited anyway, it goes back to Draft, is flagged “Edited after approval”, and the edit is logged.
- **Audit trail (History tab).** Every action is stored write-once, with who, when, page version, comments and the lock result. Each entry is SHA-256 hash-chained to the previous one, and the History tab checks the chain each time it opens.
- **Document Register.** *Apps → Document Register* in Confluence's top bar. Lists all controlled documents with number, title, type, revision, status, owner, approver, effective date and next review. Overdue reviews are highlighted. You can filter and search.

## One-time setup

You need Node.js 22 or newer and to be a Confluence site admin.

1. **Create an API token** at <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. **Install the Forge CLI and log in:**
   ```bash
   npm install -g @forge/cli
   forge login
   ```
3. **Get the code and register the app** (this gives it your own app id in `manifest.yml`):
   ```bash
   git clone https://github.com/khollstein/docseal.git && cd docseal
   npm install
   forge register
   ```
4. **Create the approver group** in Confluence: *Settings → User management → Groups → Create group* named `doc-approvers`, and add your approvers. (To use a different name, edit `src/config.js`.)
5. **Check, deploy and install:**
   ```bash
   forge lint
   forge deploy --environment production
   forge install --environment production --product confluence --site <your-site>.atlassian.net
   ```
6. In Confluence, open any page, click **Document control** in the byline, and approve the app's access prompt the first time.

### Trying it safely first

Use the default development environment (`forge deploy` / `forge install` without `--environment production`) on a free developer site from <https://go.atlassian.com/cloud-dev>, or on a test space. Use `forge logs` to see errors.

## Settings

Edit `src/config.js`, then run `forge deploy` again:

- `APPROVER_GROUP`: who can approve (default `doc-approvers`)
- `REQUIRE_INDEPENDENT_APPROVAL`: submitter can't approve their own revision (default on)
- `REVIEW_PERIOD_MONTHS`: review cycle (default 12)
- `DOC_TYPES`: document types and number prefixes
- `LOCK_APPROVED_PAGES`: restrict editing of approved pages to the approver group

## Limits worth knowing

- **Tamper-evident, not tamper-proof.** The hash chain shows if history was altered or removed, but someone with control of the app (who could redeploy it or uninstall it) could still wipe the data. Uninstalling the app deletes its stored data.
- **Locking depends on permissions.** The lock is a Confluence page restriction set by the approving user (or the app). If it can't be applied, the History tab shows “page lock FAILED”, and the edit-detection safety net still applies.
- **The byline title updates on page reload** after an action.
- **Data stays on Atlassian.** Everything is stored in Forge storage, and the app makes no calls outside Atlassian.

## Development

```bash
npm test          # workflow + audit-chain unit tests
forge tunnel      # live-reload against your dev site
```

Code layout: `src/workflow.js` (rules), `src/audit.js` (hash chain), `src/store.js` (storage), `src/confluence.js` (REST calls), `src/index.js` (resolvers, byline title, edit trigger), `src/frontend/` (UI Kit screens).

Planned for v2: watermarked PDF controlled copies, review-due reminders, CSV export of the register.
