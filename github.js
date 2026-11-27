import { createSessionClient } from './github-session.js';

// Shared GitHub + storage helpers used by the background worker, side panel and options page.

export const SECTIONS = {
  review:   { title: 'Review requested', query: (me) => `is:open is:pr archived:false user-review-requested:${me}` },
  team:     { title: 'Team review requests', query: (me) => `is:open is:pr archived:false team-review-requested-user:${me}` },
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
  sections: { review: true, team: true, created: true, assigned: false, mentioned: false, reviewed: false, merged: false },
  customFolders: [], // [{ id, title, query }] using GitHub search syntax, e.g. "repo:acme/api is:open"
  timeRangeDays: 0,
  notify: true,
  intervalMinutes: 2,
  groupName: 'Pull Requests',
  groupColor: 'blue',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings, sections: { ...DEFAULT_SETTINGS.sections, ...settings?.sections } };
  if (!settings?.intervalChosen) merged.intervalMinutes = DEFAULT_SETTINGS.intervalMinutes;
  delete merged.token;
  delete merged.authMethod;
  delete merged.showAttention;
  delete merged.folderLayoutVersion;
  if (!settings?.sessionVersion) {
    merged.timeRangeDays = 0;
  }
  merged.sessionVersion = 1;
  return merged;
}

// Status filters count each open PR once, under its most urgent reason.
export const ATTENTION_REASONS = {
  review:   { label: 'Review requested', short: 'Review' },
  changes:  { label: 'Changes requested', short: 'Changes' },
  failing:  { label: 'Checks failing', short: 'Failing' },
  ready:    { label: 'Ready to merge', short: 'Ready' },
  assigned: { label: 'Assigned to you', short: 'Assigned' },
  open:     { label: 'Open', short: 'Open' },
};
const ATTENTION_ORDER = Object.keys(ATTENTION_REASONS);

export function rankStatuses(sections) {
  const out = new Map();
  const add = (p, reason) => {
    if (p.state !== 'OPEN') return;
    const cur = out.get(p.id);
    if (!cur || ATTENTION_ORDER.indexOf(reason) < ATTENTION_ORDER.indexOf(cur.reason)) out.set(p.id, { ...p, reason });
  };
  [...(sections.review || []), ...(sections.team || [])].forEach(p => add(p, 'review'));
  for (const p of Object.values(sections).flat()) {
    const failing = p.ci === 'FAILURE' || p.ci === 'ERROR';
    if (p.reviewDecision === 'CHANGES_REQUESTED') add(p, 'changes');
    else if (failing) add(p, 'failing');
    else if (p.reviewDecision === 'APPROVED' && !p.isDraft && p.ci !== 'PENDING' && p.ci !== 'EXPECTED') add(p, 'ready');
    else add(p, 'open');
  }
  return [...out.values()].sort((a, b) =>
    ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || b.updatedAt.localeCompare(a.updatedAt));
}

// Fill an all-date cache; the sidebar applies its selected time range locally.
export function buildFolders(settings, login) {
  const finish = (q) => `${q} sort:updated-desc`;
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

// Serialize alarm/manual refreshes so older results cannot overwrite a new session.
let syncing, queuedClient;
export function sync(client = createSessionClient()) {
  if (syncing) {
    queuedClient = client;
    return syncing;
  }
  syncing = (async () => {
    let next = client;
    do {
      queuedClient = null;
      await runSync(next);
      next = queuedClient;
    } while (next);
  })().finally(() => { syncing = null; });
  return syncing;
}

async function runSync(client) {
  const settings = await getSettings();
  let prev = await chrome.storage.local.get(['settings', 'state', 'seen', 'initialized']);
  if (!prev.settings?.sessionVersion) {
    await chrome.storage.local.set({ settings, state: null, seen: {}, pinned: {}, initialized: false });
    prev = {};
  }
  try {
    const viewer = await client.identify();
    if (prev.state?.viewer?.login !== viewer.login || prev.state?.authMethod !== 'browser') {
      // Clear the previous account before doing any slower folder requests.
      await chrome.storage.local.set({ state: { viewer, authMethod: 'browser' }, pinned: {}, seen: {}, initialized: false });
      prev = { state: { viewer, authMethod: 'browser' } };
    }
    const folders = buildFolders(settings, viewer.login);
    const keys = folders.map(f => f.key);
    const all = await client.folders(folders);
    const sections = Object.fromEntries(keys.map(k => [k, all[k]]));
    const attention = rankStatuses(sections); // Internal status snapshot for change notifications.
    // Also catch an account switch during the deferred status requests.
    await client.identify();
    const blockedOrgs = client.blockedOrgs;

    const cachedPRs = [...Object.values(sections).flat(), ...(attention || [])];
    const ids = new Set(cachedPRs.map((p) => p.id));
    let seen = prev.seen || {};
    if (!prev.initialized) {
      // First run: don't flood the sidebar with unread dots.
      seen = Object.fromEntries([...ids].map((id) => [id, true]));
    } else if (prev.state?.cacheVersion !== 1) {
      // Expanding an older, date-limited cache must not announce historical PRs
      // as new. Preserve existing unread rows and updates since the last sync.
      const before = new Set([...Object.values(prev.state?.sections || {}).flat(), ...(prev.state?.attention || [])].map(p => p.id));
      for (const p of cachedPRs) {
        if (!before.has(p.id) && (!prev.state?.lastSync || Date.parse(p.updatedAt) <= prev.state.lastSync)) seen[p.id] = true;
      }
    }
    // A narrower search doesn't mean a PR is new when it reappears. Retain read
    // history across filters, bounded for long-lived profiles; account changes clear it.
    seen = Object.fromEntries(Object.entries(seen).slice(-10000));

    // Brand-new PRs in folders that need your attention -> desktop notification.
    let fresh = [];
    if (prev.initialized && settings.notify) {
      const before = new Set(Object.values(prev.state?.sections || {}).flat().map((p) => p.id));
      const watch = folders.filter((f) => f.custom || f.key === 'review' || f.key === 'team' || f.key === 'assigned').map((f) => f.key);
      const byId = new Map();
      watch.forEach((k) => (sections[k] || []).forEach((p) => { if (!before.has(p.id) && !seen[p.id]) byId.set(p.id, p); }));
      fresh = [...byId.values()];
      // Your own PRs that just got changes requested or started failing checks.
      const prevReason = new Map((prev.state?.attention || []).map((p) => [p.id, p.reason]));
      for (const p of attention || []) {
        if (p.author === viewer.login && (p.reason === 'changes' || p.reason === 'failing') && prevReason.has(p.id) && prevReason.get(p.id) !== p.reason) {
          fresh.push({ ...p, why: ATTENTION_REASONS[p.reason].label });
        }
      }
    }

    // Keep pinned PRs' details current when they're still in a folder.
    const { pinned = {} } = await chrome.storage.local.get('pinned');
    const latest = new Map([...(attention || []), ...Object.values(sections).flat()].map(({ reason, ...p }) => [p.id, p]));
    let pinnedChanged = false;
    for (const id of Object.keys(pinned)) if (latest.has(id)) { pinned[id] = { ...latest.get(id), accountLogin: viewer.login }; pinnedChanged = true; }
    if (pinnedChanged) await chrome.storage.local.set({ pinned });

    await chrome.storage.local.set({
      initialized: true,
      seen,
      state: {
        viewer,
        sections,
        attention,
        order: keys,
        titles: Object.fromEntries(folders.map((f) => [f.key, f.title])),
        timeRangeDays: settings.timeRangeDays,
        blockedOrgs,
        authMethod: 'browser',
        cacheVersion: 1,
        warnings: client.warnings,
        lastSync: Date.now(),
        error: null,
      },
    });
    if (fresh.length) notify(fresh);
  } catch (err) {
    if (err.code === 'SIGNED_OUT' || err.code === 'ACCOUNT_CHANGED') {
      await chrome.storage.local.set({ state: { needsLogin: true, error: err.message }, pinned: {}, seen: {}, initialized: false });
    } else {
      await chrome.storage.local.set({ state: { ...(prev.state || {}), error: String(err.message || err) } });
    }
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

export async function togglePin(pr, accountLogin) {
  const { pinned = {}, state } = await chrome.storage.local.get(['pinned', 'state']);
  if (!accountLogin || state?.viewer?.login !== accountLogin || state?.authMethod !== 'browser') return;
  const { reason, ...snapshot } = pr;
  if (pinned[pr.id]) delete pinned[pr.id]; else pinned[pr.id] = { ...snapshot, accountLogin };
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
  Object.values(state?.sections || {}).flat().forEach((p) => { if (!seen?.[p.id]) ids.add(p.id); });
  return ids;
}
