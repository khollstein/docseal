// Thin wrappers around the Confluence REST API.
import api, { route } from '@forge/api';
import { WorkflowError } from './workflow.js';

async function json(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${what} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function isInGroup(accountId, groupName) {
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/rest/api/user/memberof?accountId=${accountId}&limit=200`);
  const body = await json(res, 'Group lookup');
  return (body.results || []).some((g) => g.name === groupName);
}

// Read as the signed-in user first (they can see the page they're on), then as the app.
// asUser isn't available in triggers, so that path falls back to the app account, which
// needs "View" permission on the space (Space settings > Permissions > Apps).
export async function getPage(pageId) {
  let res;
  try {
    res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
  } catch {
    res = null;
  }
  if (!res || !res.ok) res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
  if (res.status === 404) {
    throw new WorkflowError('Confluence could not find this page. If it has never been published, publish it first. Otherwise give the app View permission on this space.');
  }
  const page = await json(res, 'Page lookup');
  const links = page._links || {};
  return {
    id: String(page.id),
    title: page.title,
    spaceId: page.spaceId,
    version: page.version?.number ?? null,
    url: links.base && links.webui ? `${links.base}${links.webui}` : null,
  };
}

let groupIdCache = {};
async function getGroupId(groupName) {
  if (!groupIdCache[groupName]) {
    const res = await api.asApp().requestConfluence(route`/wiki/rest/api/group/by-name?name=${groupName}`);
    groupIdCache[groupName] = (await json(res, 'Group lookup')).id;
  }
  return groupIdCache[groupName];
}

// Try as the acting user first (they usually have restrict permission), then as the app.
async function restrictionCall(method, pageId, groupId) {
  const path = route`/wiki/rest/api/content/${pageId}/restriction/byOperation/update/byGroupId/${groupId}`;
  const errors = [];
  for (const who of ['asUser', 'asApp']) {
    try {
      const res = await api[who]().requestConfluence(path, { method });
      if (res.ok || (method === 'DELETE' && res.status === 404)) return;
      errors.push(`${who}: ${res.status}`);
    } catch (err) {
      // asUser is unavailable in triggers (no signed-in user); fall through to asApp.
      errors.push(`${who}: ${err.message}`);
    }
  }
  throw new Error(`Restriction ${method} failed (${errors.join(', ')})`);
}

/** Only members of the group can edit the page. */
export async function lockPage(pageId, groupName) {
  await restrictionCall('PUT', pageId, await getGroupId(groupName));
}

/** Remove the group-only edit restriction added by lockPage. */
export async function unlockPage(pageId, groupName) {
  await restrictionCall('DELETE', pageId, await getGroupId(groupName));
}

/** Members of a group: [{ accountId, displayName }], people only (no apps/bots). */
export async function getGroupMembers(groupName) {
  const groupId = await getGroupId(groupName);
  const members = [];
  let start = 0;
  for (;;) {
    const res = await api
      .asApp()
      .requestConfluence(route`/wiki/rest/api/group/${groupId}/membersByGroupId?start=${start}&limit=200`);
    const body = await json(res, 'Group members lookup');
    const page = body.results || [];
    for (const u of page) {
      if (u.accountType === 'atlassian') members.push({ accountId: u.accountId, displayName: u.displayName || u.publicName });
    }
    if (page.length < 200) break;
    start += 200;
  }
  return members.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Post a page comment that @mentions people, so Confluence emails/notifies them.
 * `parts` is a list of strings (plain text) and { mention: accountId } objects.
 * Posted as the acting user where possible (so it reads naturally), else as the app.
 */
export async function postMentionComment(pageId, parts) {
  const html = parts
    .map((p) => (typeof p === 'string' ? escapeHtml(p) : `<ac:link><ri:user ri:account-id="${escapeHtml(p.mention)}" /></ac:link>`))
    .join('');
  const body = JSON.stringify({ pageId: String(pageId), body: { representation: 'storage', value: `<p>${html}</p>` } });
  const errors = [];
  for (const who of ['asUser', 'asApp']) {
    try {
      const res = await api[who]().requestConfluence(route`/wiki/api/v2/footer-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (res.ok) return;
      errors.push(`${who}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 150)}`);
    } catch (err) {
      errors.push(`${who}: ${err.message}`);
    }
  }
  throw new Error(`Comment failed (${errors.join('; ')})`);
}
