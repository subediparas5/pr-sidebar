// Shared GitHub + storage helpers used by the background worker, side panel and options page.

export const SECTIONS = {
  review:   { title: 'Review requested', query: (me) => `is:open is:pr archived:false review-requested:${me}` },
  created:  { title: 'Created by me',    query: (me) => `is:open is:pr archived:false author:${me}` },
  assigned: { title: 'Assigned to me',   query: (me) => `is:open is:pr archived:false assignee:${me}` },
  mentioned:{ title: 'Mentioned',        query: (me) => `is:open is:pr archived:false mentions:${me}` },
  reviewed: { title: 'Reviewed by me',   query: (me) => `is:open is:pr archived:false reviewed-by:${me} -author:${me}` },
  merged:   { title: 'Recently merged',  query: (me) => `is:pr is:merged author:${me}` },
};

export const TIME_RANGES = [
  [1, 'Last 24 hours'], [3, 'Last 3 days'], [7, 'Last week'], [14, 'Last 2 weeks'], [30, 'Last month'], [90, 'Last 3 months'], [0, 'Any time'],
];

export const DEFAULT_SETTINGS = {
  token: '',
  sections: { review: true, created: true, assigned: true, mentioned: false, reviewed: false, merged: false },
  customFolders: [], // [{ id, title, query }] using GitHub search syntax, e.g. "repo:acme/api is:open"
  timeRangeDays: 7,
  showAttention: true,
  notify: true,
  intervalMinutes: 2,
  groupName: 'Pull Requests',
  groupColor: 'blue',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings, sections: { ...DEFAULT_SETTINGS.sections, ...settings?.sections } };
  if (!settings?.intervalChosen) merged.intervalMinutes = DEFAULT_SETTINGS.intervalMinutes;
  return merged;
}

async function graphql(token, query, variables = {}, { allowPartial = false } = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw Object.assign(new Error('GitHub signed you out (token expired or revoked). Sign in again.'), { status: 401 });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const json = await res.json();
  if (allowPartial) return { data: json.data || {}, errors: json.errors || [] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

export async function fetchViewer(token) {
  const data = await graphql(token, 'query { viewer { login avatarUrl } }');
  return data.viewer;
}

const PR_FIELDS = `
  ... on PullRequest {
    id number title url updatedAt createdAt isDraft reviewDecision state
    author { login avatarUrl }
    repository { nameWithOwner owner { avatarUrl } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

// folders: [{ key, query }] -> { [key]: PR[] }
export async function fetchFolders(token, folders) {
  if (!folders.length) return {};
  const vars = folders.map((_, i) => `$q${i}: String!`).join(', ');
  const body = folders
    .map((_, i) => `s${i}: search(query: $q${i}, type: ISSUE, first: 50) { nodes { ${PR_FIELDS} } }`)
    .join('\n');
  const variables = Object.fromEntries(folders.map((f, i) => [`q${i}`, f.query]));
  const data = await graphql(token, `query(${vars}) { ${body} }`, variables);

  const out = {};
  folders.forEach((f, i) => {
    out[f.key] = (data[`s${i}`]?.nodes || []).filter((n) => n && n.id).map(toPR);
  });
  return out;
}

function toPR(n) {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    isDraft: n.isDraft,
    state: n.state, // OPEN | MERGED | CLOSED
    reviewDecision: n.reviewDecision, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
    ci: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null, // SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
    repo: n.repository.nameWithOwner,
    repoAvatar: n.repository.owner.avatarUrl,
    author: n.author?.login || 'ghost',
    authorAvatar: n.author?.avatarUrl || '',
  };
}

// "Needs your attention": open PRs that need an action from you, regardless of the time filter.
// Each PR appears once, under its most urgent reason.
export const ATTENTION_REASONS = {
  review:   { label: 'Review requested', short: 'Review' },
  changes:  { label: 'Changes requested', short: 'Changes' },
  failing:  { label: 'Checks failing', short: 'Failing' },
  ready:    { label: 'Ready to merge', short: 'Ready' },
  assigned: { label: 'Assigned to you', short: 'Assigned' },
  open:     { label: 'Open', short: 'Open' },
};
const ATTENTION_ORDER = Object.keys(ATTENTION_REASONS);

export function attentionFolders(login) {
  const base = 'is:open is:pr archived:false';
  return [
    { key: 'att:review', query: `${base} review-requested:${login} sort:updated-desc` },
    { key: 'att:mine', query: `${base} author:${login} sort:updated-desc` },
    { key: 'att:assigned', query: `${base} assignee:${login} sort:updated-desc` },
  ];
}

export function rankAttention(raw, login) {
  const out = new Map();
  const add = (p, reason) => {
    const cur = out.get(p.id);
    if (!cur || ATTENTION_ORDER.indexOf(reason) < ATTENTION_ORDER.indexOf(cur.reason)) out.set(p.id, { ...p, reason });
  };
  (raw['att:review'] || []).forEach((p) => add(p, 'review'));
  for (const p of raw['att:mine'] || []) {
    const failing = p.ci === 'FAILURE' || p.ci === 'ERROR';
    if (p.reviewDecision === 'CHANGES_REQUESTED') add(p, 'changes');
    else if (failing) add(p, 'failing');
    else if (p.reviewDecision === 'APPROVED' && !p.isDraft) add(p, 'ready');
    else add(p, 'open');
  }
  (raw['att:assigned'] || []).forEach((p) => add(p, p.author === login ? 'open' : 'assigned'));
  return [...out.values()].sort((a, b) =>
    ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || b.updatedAt.localeCompare(a.updatedAt));
}

// Turns the settings into the list of folders to fetch, with the time filter applied.
export function buildFolders(settings, login) {
  const days = Number(settings.timeRangeDays) || 0;
  const since = days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : null;
  const finish = (q) => `${q}${since ? ` updated:>=${since}` : ''} sort:updated-desc`;
  const builtIn = Object.keys(SECTIONS)
    .filter((k) => settings.sections[k])
    .map((k) => ({ key: k, title: SECTIONS[k].title, query: finish(SECTIONS[k].query(login)) }));
  const custom = (settings.customFolders || [])
    .filter((f) => f.query?.trim())
    .map((f) => {
      let q = f.query.trim().replace(/@me\b/g, login);
      if (!/\bis:pr\b|\btype:pr\b/.test(q)) q = `is:pr ${q}`;
      return { key: `custom:${f.id}`, title: f.title?.trim() || f.query.trim(), query: finish(q), custom: true };
    });
  return [...builtIn, ...custom];
}

// Finds orgs whose repos this token can't read: OAuth app access restrictions or SAML SSO.
// Search silently drops PRs from those orgs, so we have to probe each org directly.
export async function findBlockedOrgs(token) {
  const { data } = await graphql(token, 'query { viewer { organizations(first: 100) { nodes { login } } } }', {}, { allowPartial: true });
  const orgs = (data?.viewer?.organizations?.nodes || []).map((o) => o?.login).filter(Boolean);
  if (!orgs.length) return [];
  const body = orgs.map((login, i) => `o${i}: organization(login: ${JSON.stringify(login)}) { repositories(first: 1) { totalCount } }`).join('\n');
  const { errors } = await graphql(token, `query { ${body} }`, {}, { allowPartial: true });
  const blocked = new Map();
  for (const e of errors) {
    const i = Number(String(e.path?.[0] || '').slice(1));
    if (!Number.isInteger(i) || !orgs[i]) continue;
    const sso = /SAML|SSO/i.test(e.message);
    blocked.set(orgs[i], { login: orgs[i], reason: sso ? 'sso' : 'restricted' });
  }
  return [...blocked.values()];
}

// Pulls fresh data and stores it. Items not seen before are "unread", like new items in an Arc live folder.
export async function sync() {
  const settings = await getSettings();
  if (!settings.token) {
    await chrome.storage.local.set({ state: { needsToken: true } });
    return;
  }
  const prev = (await chrome.storage.local.get(['state', 'seen', 'initialized'])) || {};
  try {
    let viewer = prev.state?.viewer;
    if (!viewer || prev.state?.tokenFingerprint !== settings.token.slice(-6)) {
      viewer = await fetchViewer(settings.token);
    }
    const folders = buildFolders(settings, viewer.login);
    const keys = folders.map((f) => f.key);
    const [sections, attRaw, blockedOrgs] = await Promise.all([
      fetchFolders(settings.token, folders),
      settings.showAttention ? fetchFolders(settings.token, attentionFolders(viewer.login)) : {},
      findBlockedOrgs(settings.token).catch(() => []),
    ]);
    const attention = settings.showAttention ? rankAttention(attRaw, viewer.login) : null;

    const ids = new Set([...Object.values(sections).flat(), ...(attention || [])].map((p) => p.id));
    let seen = prev.seen || {};
    if (!prev.initialized) {
      // First run: don't flood the sidebar with unread dots.
      seen = Object.fromEntries([...ids].map((id) => [id, true]));
    }
    // Forget PRs that are gone (merged/closed) so the map stays small.
    seen = Object.fromEntries(Object.keys(seen).filter((id) => ids.has(id)).map((id) => [id, true]));

    // Brand-new PRs in folders that need your attention -> desktop notification.
    let fresh = [];
    if (prev.initialized && settings.notify) {
      const before = new Set(Object.values(prev.state?.sections || {}).flat().map((p) => p.id));
      const watch = folders.filter((f) => f.custom || f.key === 'review' || f.key === 'assigned').map((f) => f.key);
      const byId = new Map();
      watch.forEach((k) => (sections[k] || []).forEach((p) => { if (!before.has(p.id) && !seen[p.id]) byId.set(p.id, p); }));
      fresh = [...byId.values()];
      // Your own PRs that just got changes requested or started failing checks.
      const prevReason = new Map((prev.state?.attention || []).map((p) => [p.id, p.reason]));
      for (const p of attention || []) {
        if ((p.reason === 'changes' || p.reason === 'failing') && prevReason.has(p.id) && prevReason.get(p.id) !== p.reason) {
          fresh.push({ ...p, why: ATTENTION_REASONS[p.reason].label });
        }
      }
    }

    // Keep pinned PRs' details current when they're still in a folder.
    const { pinned = {} } = await chrome.storage.local.get('pinned');
    const latest = new Map([...(attention || []), ...Object.values(sections).flat()].map(({ reason, ...p }) => [p.id, p]));
    let pinnedChanged = false;
    for (const id of Object.keys(pinned)) if (latest.has(id)) { pinned[id] = latest.get(id); pinnedChanged = true; }
    if (pinnedChanged) await chrome.storage.local.set({ pinned });

    await chrome.storage.local.set({
      initialized: true,
      seen,
      state: {
        viewer,
        tokenFingerprint: settings.token.slice(-6),
        sections,
        attention,
        order: keys,
        titles: Object.fromEntries(folders.map((f) => [f.key, f.title])),
        timeRangeDays: settings.timeRangeDays,
        blockedOrgs,
        authMethod: settings.authMethod,
        lastSync: Date.now(),
        error: null,
      },
    });
    if (fresh.length) notify(fresh);
  } catch (err) {
    await chrome.storage.local.set({
      state: { ...(prev.state || {}), needsToken: err.status === 401, error: String(err.message || err), lastSync: Date.now() },
    });
  }
}

function notify(prs) {
  if (!chrome.notifications) return;
  if (prs.length > 3) {
    chrome.notifications.create('pr-sidebar:many', {
      type: 'basic', iconUrl: 'icons/icon128.png', title: `${prs.length} new pull requests`,
      message: prs.slice(0, 4).map((p) => `${p.repo.split('/')[1]}#${p.number} ${p.title}`).join('\n'),
    });
    return;
  }
  for (const p of prs) {
    chrome.notifications.create(`pr-sidebar:${p.id}|${p.url}`, {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: p.why ? `${p.why}: ${p.title}` : p.title, message: `${p.repo} #${p.number} by ${p.author}`, contextMessage: 'PR Sidebar',
    });
  }
}

export async function togglePin(pr) {
  const { pinned = {} } = await chrome.storage.local.get('pinned');
  const { reason, ...snapshot } = pr;
  if (pinned[pr.id]) delete pinned[pr.id]; else pinned[pr.id] = snapshot;
  await chrome.storage.local.set({ pinned });
}

export async function markRead(ids) {
  const { seen = {} } = await chrome.storage.local.get('seen');
  ids.forEach((id) => (seen[id] = true));
  await chrome.storage.local.set({ seen });
}

export async function markUnread(id) {
  const { seen = {} } = await chrome.storage.local.get('seen');
  delete seen[id];
  await chrome.storage.local.set({ seen });
}

export function unreadIds(state, seen) {
  const ids = new Set();
  [...Object.values(state?.sections || {}).flat(), ...(state?.attention || [])].forEach((p) => { if (!seen?.[p.id]) ids.add(p.id); });
  return ids;
}

// ---- Sign in with GitHub (OAuth device flow: no client secret or backend needed) ----

export const GITHUB_CLIENT_ID = 'Ov23li8KcNAg9CfQGgzp';
const SCOPES = 'repo read:org';

async function postForm(url, params, retried = false) {
  let res;
  try {
    res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    });
  } catch (err) {
    // Chrome can take a moment to apply new host access; try once more before giving up.
    if (!retried) { await new Promise((r) => setTimeout(r, 1000)); return postForm(url, params, true); }
    throw new Error('Could not reach github.com (blocked or offline). Reload PR Sidebar in chrome://extensions and try again.');
  }
  if (!res.ok) throw new Error(`GitHub sign-in error ${res.status}`);
  return res.json();
}

// Step 1: ask GitHub for a code the user types at github.com/login/device.
export async function startDeviceFlow() {
  const data = await postForm('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID, scope: SCOPES });
  if (data.error) {
    throw new Error(data.error === 'device_flow_disabled'
      ? 'Device Flow is turned off for the PR Sidebar OAuth app. Enable it in the app settings on GitHub.'
      : data.error_description || data.error);
  }
  return data; // { device_code, user_code, verification_uri, expires_in, interval }
}

// Step 2: poll until the user approves, then save the token. Pass an AbortSignal to cancel.
export async function waitForDeviceToken(flow, signal) {
  let interval = (flow.interval || 5) * 1000;
  const deadline = Date.now() + flow.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, interval);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    });
    const data = await postForm('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      device_code: flow.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (data.access_token) {
      const prev = await getSettings();
      await chrome.storage.local.set({ settings: { ...prev, token: data.access_token, authMethod: 'oauth' } });
      await chrome.runtime.sendMessage({ type: 'settingsChanged' }).catch(() => {});
      return fetchViewer(data.access_token);
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval = (data.interval || interval / 1000 + 5) * 1000; continue; }
    if (data.error === 'access_denied') throw new Error('Sign-in was cancelled on GitHub.');
    if (data.error === 'expired_token') break;
    throw new Error(data.error_description || data.error || 'Sign-in failed');
  }
  throw new Error('The sign-in code expired. Try again.');
}

export async function signOut() {
  const prev = await getSettings();
  await chrome.storage.local.set({ settings: { ...prev, token: '', authMethod: null } });
  await chrome.storage.local.remove(['state', 'seen', 'initialized']);
  await chrome.runtime.sendMessage({ type: 'settingsChanged' }).catch(() => {});
}
