import {
  GITHUB_CLIENT_ID, SECTIONS, TIME_RANGES, ATTENTION_REASONS, getSettings, markRead, markUnread, unreadIds, togglePin,
  startDeviceFlow, waitForDeviceToken,
} from './github.js';

const $ = (id) => document.getElementById(id);
const COLLAPSE_KEY = 'collapsedFolders';
const APP_ACCESS_URL = `https://github.com/settings/connections/applications/${GITHUB_CLIENT_ID}`;

let state = null;
let seen = {};
let collapsed = {};
let currentUrl = '';
let signinError = '';
let pinned = {};
let view = { groupByRepo: false, hideDrafts: false };
let quick = null; // an attention reason key, e.g. 'review' | 'changes' | 'failing' | 'ready'

// The panel's accent follows the PR tab group's color, so both read as one space.
const GROUP_COLORS = {
  grey: '#6b7280', blue: '#2563eb', red: '#dc2626', yellow: '#c58a00', green: '#16a34a',
  pink: '#db2777', purple: '#7c3aed', cyan: '#0891b2', orange: '#ea580c',
};
function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', GROUP_COLORS[color] || GROUP_COLORS.blue);
}

const svg = (body) => `<svg viewBox="0 0 16 16">${body}</svg>`;
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 10 10"><path d="M2.5 3.5 5 6l2.5-2.5"/></svg>',
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  x: svg('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>'),
  dotSpin: svg('<circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/>'),
  pin: svg('<path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l.5 3-6-6 3 .5L8.5 5zM5.5 10.5l-3 3"/>'),
  eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  pr: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6"/>'),
  user: svg('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.7-2.3 2.7-3.5 5-3.5s4.3 1.2 5 3.5"/>'),
  at: svg('<circle cx="8" cy="8" r="2.5"/><path d="M10.5 8v1a1.8 1.8 0 0 0 3.5 0V8A6 6 0 1 0 11 13.2"/>'),
  reviewed: svg('<path d="M2.5 8.5 5.5 11.5 13.5 3.5"/>'),
  merge: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="8" r="1.5"/><path d="M4.5 5v6M4.5 5c0 2 2 3 5.5 3"/>'),
  folder: svg('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>'),
};
const FOLDER_STYLE = {
  attention: { icon: svg('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3h0"/>') },
  pinned:    { icon: ICON.pin,      bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  review:    { icon: ICON.eye,      bg: 'rgba(47,107,255,.13)', fg: 'var(--blue)' },
  created:   { icon: ICON.pr,       bg: 'var(--green-soft)', fg: 'var(--green)' },
  assigned:  { icon: ICON.user,     bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  mentioned: { icon: ICON.at,       bg: 'rgba(236,72,153,.13)', fg: '#e0479e' },
  reviewed:  { icon: ICON.reviewed, bg: 'rgba(20,184,166,.14)', fg: '#0fa596' },
  merged:    { icon: ICON.merge,    bg: 'var(--purple-soft)', fg: 'var(--purple)' },
  custom:    { icon: ICON.folder,   bg: 'var(--gray-soft)', fg: 'var(--fg-2)' },
};

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sameUrl = (tabUrl, prUrl) => !!tabUrl && (tabUrl === prUrl || tabUrl.startsWith(prUrl + '/') || tabUrl.startsWith(prUrl + '#') || tabUrl.startsWith(prUrl + '?'));

// ---------- Rendering ----------

function render() {
  const needsToken = !!state?.needsToken;
  $('empty').hidden = !needsToken;
  $('app').hidden = needsToken;
  $('error').hidden = !(signinError || state?.error);
  $('error').textContent = signinError || state?.error || '';
  renderHeader();
  if (needsToken) return;
  if (!state?.sections) { renderSkeleton(); return; }
  renderOrgs();
  renderStats();

  const q = $('filter').value.trim().toLowerCase();
  const unread = unreadIds(state, seen);
  const matches = (p) => (!view.hideDrafts || !p.isDraft) &&
    (!q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q));

  const main = $('folders');
  main.innerHTML = '';
  if (state.attention) {
    const att = state.attention.filter((p) => matches(p) && (!quick || p.reason === quick));
    main.appendChild(renderFolder('attention', quick ? ATTENTION_REASONS[quick].label : 'Needs your attention', att, unread, q));
  }
  if (quick) return; // a quick filter narrows the view to the attention folder
  const pins = Object.values(pinned);
  if (pins.length) main.appendChild(renderFolder('pinned', 'Pinned', pins.filter(matches), unread, q));
  for (const key of state.order || []) {
    const title = state.titles?.[key] || SECTIONS[key]?.title || key;
    main.appendChild(renderFolder(key, title, (state.sections?.[key] || []).filter(matches), unread, q));
  }
}

function renderHeader() {
  const v = state?.viewer;
  $('avatar').hidden = !v;
  $('app-glyph').hidden = !!v;
  if (v && $('avatar').getAttribute('src') !== v.avatarUrl) $('avatar').src = v.avatarUrl;
  let synced = '';
  if (state?.lastSync) {
    const a = ago(new Date(state.lastSync).toISOString());
    synced = a === 'now' ? 'Updated just now' : `Updated ${a} ago`;
  }
  $('status').textContent = state?.needsToken ? 'Not signed in' : synced || 'Loading…';
  $('avatar').title = v ? `Signed in as @${v.login}` : '';
  $('refresh').hidden = !!state?.needsToken;
}

function renderStats() {
  const att = state.attention || [];
  const keys = ['review', 'changes', 'failing', 'ready'];
  const chips = state.attention
    ? keys.map((k) => ({ key: k, n: att.filter((p) => p.reason === k).length, label: ATTENTION_REASONS[k].short })).filter((c) => c.n || c.key === quick)
    : [];
  if (quick && !chips.some((c) => c.key === quick)) quick = null;
  $('stats').hidden = !chips.length;
  $('stats').innerHTML = chips.map((c) =>
    `<button class="qf ${c.key}${c.n ? '' : ' zero'}" data-key="${c.key}" aria-pressed="${quick === c.key}"
      title="${quick === c.key ? 'Show all folders' : `Show only: ${ATTENTION_REASONS[c.key].label.toLowerCase()}`}"><i></i><span class="n">${c.n}</span>${c.label}</button>`).join('');
  $('stats').querySelectorAll('.qf').forEach((b) => b.addEventListener('click', () => {
    quick = quick === b.dataset.key ? null : b.dataset.key;
    render();
  }));
}

function renderSkeleton() {
  $('stats').hidden = true;
  const row = '<div class="skel-row"><div class="a shimmer"></div><div class="b"><div class="shimmer"></div><div class="shimmer"></div></div></div>';
  $('folders').innerHTML = `<div class="skel">${row.repeat(6)}</div>`;
}

function renderOrgs() {
  const box = $('orgs');
  const blocked = state?.blockedOrgs || [];
  box.hidden = !blocked.length;
  if (!blocked.length) return;
  box.innerHTML = blocked.map((o) => o.reason === 'sso'
    ? `<p><b>${esc(o.login)}</b> uses SSO. <a href="https://github.com/orgs/${encodeURIComponent(o.login)}/sso" target="_blank">Sign in to SSO</a>, then sign out and back in here.</p>`
    : `<p><b>${esc(o.login)}</b> hasn't approved PR Sidebar, so its PRs are hidden. <a href="${APP_ACCESS_URL}" target="_blank">Grant or request access</a></p>`
  ).join('');
}

function renderFolder(key, title, prs, unread, q) {
  const style = FOLDER_STYLE[key] || FOLDER_STYLE[key.split(':')[0]] || FOLDER_STYLE.custom;
  const nUnread = prs.filter((p) => unread.has(p.id)).length;
  const folder = document.createElement('section');
  folder.className = 'folder' + (collapsed[key] ? ' collapsed' : '');
  folder.dataset.key = key;
  folder.innerHTML = `
    <div class="folder-row" role="button" tabindex="0" aria-expanded="${!collapsed[key]}">
      ${ICON.chev}
      <span class="folder-name">${esc(title)}</span>
      ${nUnread ? `<span class="folder-unread">${nUnread} new</span>` : `<span class="folder-count">${prs.length || ''}</span>`}
      <span class="folder-glyph">${style.icon}</span>
    </div>
    <div class="items"></div>`;
  const row = folder.querySelector('.folder-row');
  const toggle = () => {
    collapsed[key] = !collapsed[key];
    chrome.storage.local.set({ [COLLAPSE_KEY]: collapsed });
    folder.classList.toggle('collapsed');
    row.setAttribute('aria-expanded', String(!collapsed[key]));
  };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  row.addEventListener('contextmenu', (e) => showMenu(e, [
    ['Mark all as read', () => markRead(prs.map((p) => p.id))],
    ['Open all in tab group', () => prs.forEach((p, i) => openPR(p, i === prs.length - 1))],
  ]));

  const items = folder.querySelector('.items');
  if (!prs.length) {
    const range = TIME_RANGES.find(([d]) => d === Number(state.timeRangeDays));
    const hint = q ? 'No matches' : key === 'attention' ? 'Nothing needs you right now' : key === 'pinned' ? 'Nothing pinned' : range && range[0] ? `Nothing updated in the ${range[1].toLowerCase()}` : 'All clear';
    items.innerHTML = `<div class="folder-empty">${esc(hint)}</div>`;
  }
  if (view.groupByRepo && prs.length) {
    const byRepo = new Map();
    prs.forEach((p) => { if (!byRepo.has(p.repo)) byRepo.set(p.repo, []); byRepo.get(p.repo).push(p); });
    for (const [repo, list] of [...byRepo].sort((x, y) => x[0].localeCompare(y[0]))) {
      const head = document.createElement('div');
      head.className = 'repo-head';
      head.innerHTML = `<img src="${esc(list[0].repoAvatar)}" alt="" />${esc(repo)}`;
      items.appendChild(head);
      list.forEach((p) => items.appendChild(renderItem(p, unread, true)));
    }
  } else {
    prs.forEach((p) => items.appendChild(renderItem(p, unread, false)));
  }
  return folder;
}

function reasonChip(p) {
  const days = Math.floor((Date.now() - new Date(p.createdAt || p.updatedAt)) / 864e5);
  switch (p.reason) {
    case 'review': return '<span class="chip chip-review">Review requested</span>';
    case 'changes': return '<span class="chip chip-changes">Changes requested</span>';
    case 'failing': return '<span class="chip chip-changes">Checks failing</span>';
    case 'ready': return '<span class="chip chip-approved">Ready to merge</span>';
    case 'assigned': return '<span class="chip chip-assigned">Assigned to you</span>';
    default: return `<span class="chip chip-draft">${p.isDraft ? 'Draft' : 'Open'}${days > 0 ? `, ${days}d` : ''}</span>`;
  }
}

function statusChip(p) {
  if (p.reason) return reasonChip(p);
  if (p.state === 'MERGED') return '<span class="chip chip-merged">Merged</span>';
  if (p.isDraft) return '<span class="chip chip-draft">Draft</span>';
  if (p.reviewDecision === 'APPROVED') return '<span class="chip chip-approved">Approved</span>';
  if (p.reviewDecision === 'CHANGES_REQUESTED') return '<span class="chip chip-changes">Changes</span>';
  return '';
}

function ciBadge(p) {
  if (!p.ci || p.state === 'MERGED') return '';
  const icon = p.ci === 'SUCCESS' ? ICON.check : p.ci === 'FAILURE' || p.ci === 'ERROR' ? ICON.x : ICON.dotSpin;
  return `<span class="ci ci-${p.ci}" title="Checks: ${p.ci.toLowerCase()}">${icon}</span>`;
}

function renderItem(p, unread, inRepoGroup) {
  const el = document.createElement('div');
  const isUnread = unread.has(p.id);
  const isPinned = !!pinned[p.id];
  el.className = 'item ' + (isUnread ? 'unread' : 'read') + (sameUrl(currentUrl, p.url) ? ' current' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'link');
  el.setAttribute('aria-label', `${isUnread ? 'New: ' : ''}${p.title}, ${p.repo} pull request ${p.number} by ${p.author}`);
  el.title = `${p.title}\n${p.repo} #${p.number} by ${p.author}`;
  const img = inRepoGroup ? p.authorAvatar || p.repoAvatar : p.repoAvatar;
  el.innerHTML = `
    <span class="node"></span>
    <span class="pr-avatar"><img src="${esc(img)}" alt="" loading="lazy" />${ciBadge(p)}</span>
    <div class="text">
      <div class="line1"><span class="title">${esc(p.title)}</span><span class="time">${ago(p.updatedAt)}</span></div>
      <div class="meta">
        <span class="where">${inRepoGroup ? '' : `<span class="repo">${esc(p.repo.split('/')[1])}</span> `}#${p.number} by ${esc(p.author)}</span>
        ${statusChip(p)}
      </div>
    </div>
    <button class="pin-btn${isPinned ? ' on' : ''}" title="${isPinned ? 'Unpin' : 'Pin to top'}" aria-label="${isPinned ? 'Unpin' : 'Pin to top'}">${ICON.pin}</button>`;
  el.addEventListener('click', (e) => openPR(p, true, e.metaKey || e.ctrlKey));
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.key === 'Enter') { e.preventDefault(); openPR(p, true, e.metaKey || e.ctrlKey); }
    if (e.key === 'p') togglePin(p);
    if (e.key === 'u') (isUnread ? markRead([p.id]) : markUnread(p.id));
  });
  el.querySelector('.pin-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePin(p); });
  el.addEventListener('contextmenu', (e) => showMenu(e, [
    [isPinned ? 'Unpin' : 'Pin to top', () => togglePin(p)],
    isUnread ? ['Mark as read', () => markRead([p.id])] : ['Mark as unread', () => markUnread(p.id)],
    '-',
    ['Copy link', () => navigator.clipboard.writeText(p.url)],
    ['Copy as Markdown', () => navigator.clipboard.writeText(`[${p.repo}#${p.number}: ${p.title}](${p.url})`)],
    '-',
    ['Open in new window', () => { markRead([p.id]); chrome.windows.create({ url: p.url }); }],
  ]));
  return el;
}

// ---------- Actions ----------

// Opens the PR in the "Pull Requests" tab group of this window (the Arc-style space), reusing an existing tab.
async function openPR(p, activate = true, background = false) {
  markRead([p.id]);
  const settings = await getSettings();
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  let tab = tabs.find((t) => sameUrl(t.url || t.pendingUrl, p.url));
  if (tab) {
    if (activate && !background) await chrome.tabs.update(tab.id, { active: true });
  } else {
    tab = await chrome.tabs.create({ url: p.url, windowId: win.id, active: activate && !background });
  }
  const [group] = await chrome.tabGroups.query({ windowId: win.id, title: settings.groupName });
  if (group) {
    if (tab.groupId !== group.id) await chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
    if (group.collapsed && activate && !background) await chrome.tabGroups.update(group.id, { collapsed: false });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: win.id } });
    await chrome.tabGroups.update(groupId, { title: settings.groupName, color: settings.groupColor });
  }
}

// entries: [label, fn, checked?] or '-' for a divider
function showMenu(e, entries) {
  e.preventDefault();
  const menu = $('menu');
  menu.innerHTML = '';
  const hasChecks = entries.some((x) => Array.isArray(x) && x.length > 2);
  for (const entry of entries) {
    if (entry === '-') { menu.appendChild(document.createElement('hr')); continue; }
    const [label, fn, checked] = entry;
    const b = document.createElement('button');
    b.innerHTML = `${hasChecks ? `<span class="check">${checked ? ICON.check : ''}</span>` : ''}<span>${esc(label)}</span>`;
    b.addEventListener('click', () => { menu.hidden = true; fn(); });
    menu.appendChild(b);
  }
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';
}
document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });

async function refresh() {
  $('refresh').classList.add('spinning');
  try { await chrome.runtime.sendMessage({ type: 'sync' }); } catch {} finally { $('refresh').classList.remove('spinning'); }
}

async function trackActiveTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = t?.url || '';
  render();
}

async function openSettings() {
  const url = chrome.runtime.getURL('options.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

$('refresh').addEventListener('click', refresh);
$('settings').addEventListener('click', openSettings);
$('use-token').addEventListener('click', (e) => { e.preventDefault(); openSettings(); });

// ---------- Sign in ----------

let signinAbort = null;
function showSigninStep(step) {
  $('signin-start').hidden = step !== 'start';
  $('signin-code').hidden = step !== 'code';
}
function showSigninError(text) {
  signinError = text;
  $('error').hidden = !text && !state?.error;
  $('error').textContent = text || state?.error || '';
}
$('signin').addEventListener('click', async () => {
  showSigninError('');
  const hasAccess = await chrome.permissions.contains({ origins: ['https://github.com/*'] });
  if (!hasAccess) {
    showSigninError('Chrome has not given PR Sidebar access to github.com yet. In chrome://extensions, click Remove on PR Sidebar, then Load unpacked the folder again.');
    return;
  }
  const label = $('signin').querySelector('span');
  $('signin').disabled = true;
  label.textContent = 'Contacting GitHub…';
  try {
    const flow = await startDeviceFlow();
    $('user-code').textContent = flow.user_code;
    $('open-github').onclick = async () => {
      try { await navigator.clipboard.writeText(flow.user_code); } catch {}
      chrome.tabs.create({ url: flow.verification_uri });
    };
    showSigninStep('code');
    signinAbort = new AbortController();
    await waitForDeviceToken(flow, signinAbort.signal);
    showSigninStep('start'); // storage change re-renders into the folders view
  } catch (err) {
    showSigninStep('start');
    if (err.name !== 'AbortError') showSigninError(err.message === 'Failed to fetch' ? 'Could not reach github.com. Check your connection and try again.' : err.message);
  } finally {
    $('signin').disabled = false;
    label.textContent = 'Sign in with GitHub';
    signinAbort = null;
  }
});
$('cancel-signin').addEventListener('click', (e) => { e.preventDefault(); signinAbort?.abort(); });

// ---------- Toolbar ----------

$('filter').addEventListener('input', render);
$('filter').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('filter').value = ''; render(); $('filter').blur(); } });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.matches('select')) {
    const stops = [...document.querySelectorAll('#folders .folder-row, #folders .folder:not(.collapsed) .item')];
    if (!stops.length) return;
    e.preventDefault();
    const i = stops.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? stops[Math.min(i + 1, stops.length - 1)] : stops[Math.max(i - 1, 0)];
    (i === -1 ? stops[0] : next).focus();
    return;
  }
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === '/') { e.preventDefault(); $('filter').focus(); }
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) refresh();
});

const SHORT_RANGE = { 1: '24 hours', 3: '3 days', 7: '1 week', 14: '2 weeks', 30: '1 month', 90: '3 months', 0: 'Any time' };
$('range').innerHTML = TIME_RANGES.map(([d, label]) => `<option value="${d}" title="${label}">${SHORT_RANGE[d] || label}</option>`).join('');
$('range').addEventListener('change', async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ settings: { ...settings, timeRangeDays: Number($('range').value) } });
  refresh();
});

$('view').addEventListener('click', (e) => {
  e.stopPropagation();
  const r = $('view').getBoundingClientRect();
  const toggle = (k) => () => { view[k] = !view[k]; chrome.storage.local.set({ view }); render(); };
  showMenu({ preventDefault() {}, clientX: r.right - 200, clientY: r.bottom + 6 }, [
    ['Group by repository', toggle('groupByRepo'), view.groupByRepo],
    ['Hide drafts', toggle('hideDrafts'), view.hideDrafts],
    '-',
    ['Mark everything as read', () => markRead([...unreadIds(state, seen)]), false],
    ['Edit folders…', openSettings, false],
    ['Missing org PRs?', () => chrome.tabs.create({ url: state?.authMethod === 'pat' ? 'https://github.com/settings/tokens' : APP_ACCESS_URL }), false],
  ]);
});

// ---------- Live updates ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.state) state = changes.state.newValue;
  if (changes.seen) seen = changes.seen.newValue || {};
  if (changes.pinned) pinned = changes.pinned.newValue || {};
  if (changes.settings) {
    $('range').value = String(changes.settings.newValue?.timeRangeDays ?? 7);
    applyAccent(changes.settings.newValue?.groupColor);
  }
  if (changes.state || changes.seen || changes.pinned) render();
});
chrome.tabs.onActivated.addListener(trackActiveTab);
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.url && tab.active) trackActiveTab(); });
setInterval(render, 60_000); // keep "5m ago" labels fresh

(async () => {
  const data = await chrome.storage.local.get(['state', 'seen', 'pinned', 'view', COLLAPSE_KEY]);
  const settings = await getSettings();
  pinned = data.pinned || {};
  view = { ...view, ...data.view };
  $('range').value = String(settings.timeRangeDays);
  applyAccent(settings.groupColor);
  // No token and nothing cached: go straight to sign-in instead of a skeleton.
  state = data.state || (settings.token ? null : { needsToken: true });
  seen = data.seen || {};
  collapsed = data[COLLAPSE_KEY] || {};
  await trackActiveTab();
  refresh();
})();
