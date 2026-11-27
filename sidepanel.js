import {
  SECTIONS, TIME_RANGES, ATTENTION_REASONS, rankStatuses, getSettings, markRead, markUnread, unreadIds, togglePin,
} from './github.js';

const $ = (id) => document.getElementById(id);
const COLLAPSE_KEY = 'collapsedFolders';

let state = null;
let seen = {};
let collapsed = {};
let currentUrl = '';
let settings;
let pinned = {};
let view = { groupByRepo: false, hideDrafts: false, hiddenRepos: [] };
let quick = null; // 'review' | 'changes' | 'failing' | 'ready'

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
  pinned:    { icon: ICON.pin,      bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  review:    { icon: ICON.eye,      bg: 'rgba(47,107,255,.13)', fg: 'var(--blue)' },
  team:      { icon: ICON.eye },
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
  const needsLogin = !!state?.needsLogin;
  $('empty').hidden = !needsLogin;
  $('app').hidden = needsLogin;
  $('error').hidden = !state?.error;
  $('error').textContent = state?.error || '';
  $('warning').hidden = !state?.warnings?.length;
  $('warning').textContent = (state?.warnings || []).join(' ');
  renderHeader();
  renderOrgs();
  if (needsLogin) { $('folders').innerHTML = ''; $('stats').hidden = true; return; }
  if (!state?.sections) {
    if (state?.error) { $('stats').hidden = true; $('folders').innerHTML = '<div class="folder-empty">Open GitHub or refresh to try again.</div>'; }
    else renderSkeleton();
    return;
  }
  const q = $('filter').value.trim().toLowerCase();
  const unread = unreadIds(state, seen);
  const matches = p => (!view.hideDrafts || !p.isDraft) && !view.hiddenRepos.includes(p.repo) &&
    (!q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q));
  const days = Number(settings?.timeRangeDays) || 0;
  const cutoff = days ? Date.now() - days * 864e5 : -Infinity;
  const inRange = p => Date.parse(p.updatedAt) >= cutoff;
  const sections = Object.fromEntries((state.order || []).map(key =>
    [key, (state.sections?.[key] || []).filter(p => matches(p) && inRange(p))]));
  const pins = Object.values(pinned).filter(p => (!p.accountLogin || p.accountLogin === state.viewer?.login) && matches(p) && inRange(p));
  const statuses = rankStatuses({ ...sections, pinned: pins });
  renderStats(statuses);
  const quickIds = new Set(statuses.filter(p => p.reason === quick).map(p => p.id));
  const matchesQuick = p => !quick || quickIds.has(p.id);
  const main = $('folders');
  main.innerHTML = '';
  const shownPins = pins.filter(matchesQuick);
  if (shownPins.length) main.appendChild(renderFolder('pinned', 'Pinned', shownPins, unread, q));
  for (const key of state.order || []) {
    const title = state.titles?.[key] || SECTIONS[key]?.title || key;
    const prs = sections[key].filter(matchesQuick);
    if (quick && !prs.length) continue;
    main.appendChild(renderFolder(key, title, prs, unread, q));
  }
  if (quick && !main.children.length) main.innerHTML = '<div class="folder-empty">No matches in the selected filters</div>';
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
  $('status').textContent = state?.needsLogin ? 'Not signed in' : synced || 'Loading…';
  $('avatar').title = v ? `Signed in as @${v.login}` : '';
  $('account').title = v ? `@${v.login} · Open GitHub` : 'Open GitHub';
}

function renderStats(statuses) {
  const keys = ['review', 'changes', 'failing', 'ready'];
  $('stats').hidden = false;
  $('stats').innerHTML = keys.map(key => {
    const n = statuses.filter(p => p.reason === key).length;
    return `<button class="qf ${key}${n ? '' : ' zero'}" data-key="${key}" aria-pressed="${quick === key}"
      title="${quick === key ? 'Show all folders' : ATTENTION_REASONS[key].label}"><i></i><span class="n">${n}</span>${ATTENTION_REASONS[key].short}</button>`;
  }).join('');
  $('stats').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    quick = quick === button.dataset.key ? null : button.dataset.key;
    render();
    $('stats').querySelector(`[data-key="${button.dataset.key}"]`)?.focus();
  }));
}

function renderSkeleton() {
  $('stats').hidden = true;
  const row = '<div class="skel-row"><div class="a shimmer"></div><div class="b"><div class="shimmer"></div><div class="shimmer"></div></div></div>';
  $('folders').innerHTML = `<div class="skel">${row.repeat(6)}</div>`;
}

function renderOrgs() {
  const blocked = state?.blockedOrgs || [];
  $('orgs').hidden = !blocked.length;
  $('orgs').innerHTML = blocked.map(o => `<p><b>${esc(o.login)}</b> needs SSO. <a href="https://github.com/orgs/${encodeURIComponent(o.login)}/sso" target="_blank" rel="noreferrer">Sign in on GitHub</a>, then refresh.</p>`).join('');
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
    ['Open all in tab group', async () => { for (const p of prs) await openPR(p, false); }],
  ]));

  const items = folder.querySelector('.items');
  if (!prs.length) {
    const range = TIME_RANGES.find(([d]) => d === Number(settings?.timeRangeDays));
    const hint = q ? 'No matches' : key === 'pinned' ? 'Nothing pinned' : range && range[0] ? `Nothing updated in the ${range[1].toLowerCase()}` : 'All clear';
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
      list.forEach((p) => items.appendChild(renderItem(p, unread, true, key)));
    }
  } else {
    prs.forEach((p) => items.appendChild(renderItem(p, unread, false, key)));
  }
  return folder;
}

function reasonChip(p) {
  const days = Math.floor((Date.now() - new Date(p.createdAt || p.updatedAt)) / 864e5);
  switch (p.reason) {
    case 'review': return '<span class="chip chip-review">Review requested</span>';
    case 'changes': return '<span class="chip chip-changes">Changes requested</span>';
    case 'failing': return '<span class="chip chip-changes">Checks failing</span>';
    case 'ready': return '<span class="chip chip-approved" title="Approved with no known failing or pending checks. Confirm remaining merge requirements on GitHub.">Ready to merge</span>';
    case 'assigned': return '<span class="chip chip-assigned">Assigned to you</span>';
    default: return `<span class="chip chip-draft">${p.isDraft ? 'Draft' : 'Open'}${days > 0 ? `, ${days}d` : ''}</span>`;
  }
}

function statusChip(p, folderKey) {
  if (p.state === 'MERGED') return '<span class="chip chip-merged">Merged</span>';
  if (p.state === 'CLOSED') return '<span class="chip chip-closed">Closed</span>';
  if (p.reason) return reasonChip(p);
  if (p.isDraft) return '<span class="chip chip-draft">Draft</span>';
  if (p.reviewDecision === 'APPROVED') return '<span class="chip chip-approved">Approved</span>';
  if (p.reviewDecision === 'CHANGES_REQUESTED') return '<span class="chip chip-changes">Changes</span>';
  if (folderKey === 'review' || folderKey === 'team') return '<span class="chip chip-review">Needs your review</span>';
  if (folderKey === 'created') return '<span class="chip chip-opened">Opened by you</span>';
  if (folderKey === 'assigned') return '<span class="chip chip-assigned">Assigned to you</span>';
  return '';
}

function ciBadge(p) {
  if (!p.ci || p.state === 'MERGED') return '';
  const icon = p.ci === 'SUCCESS' ? ICON.check : p.ci === 'FAILURE' || p.ci === 'ERROR' ? ICON.x : ICON.dotSpin;
  return `<span class="ci ci-${p.ci}" title="Checks: ${p.ci.toLowerCase()}">${icon}</span>`;
}

function renderItem(p, unread, inRepoGroup, folderKey) {
  const accountLogin = state?.viewer?.login;
  const el = document.createElement('div');
  const isUnread = unread.has(p.id);
  const isPinned = !!pinned[p.id];
  el.className = 'item ' + (isUnread ? 'unread' : 'read') + (sameUrl(currentUrl, p.url) ? ' current' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'link');
  const prState = p.state?.toLowerCase() || 'open';
  el.setAttribute('aria-label', `${isUnread ? 'New: ' : ''}${p.title}, ${prState}, ${p.repo} pull request ${p.number} by ${p.author}`);
  el.title = `${p.title}\n${p.repo} #${p.number} by ${p.author} · ${prState}`;
  const img = inRepoGroup ? p.authorAvatar || p.repoAvatar : p.repoAvatar;
  el.innerHTML = `
    <span class="node"></span>
    <span class="pr-avatar"><img src="${esc(img)}" alt="" loading="lazy" />${ciBadge(p)}</span>
    <div class="text">
      <div class="line1"><span class="title">${esc(p.title)}</span><span class="time">${ago(p.updatedAt)}</span></div>
      <div class="meta">
        <span class="where">${inRepoGroup ? '' : `<span class="repo">${esc(p.repo.split('/')[1])}</span> `}#${p.number} by ${esc(p.author)}</span>
        ${statusChip(p, folderKey)}
      </div>
    </div>
    <button class="pin-btn${isPinned ? ' on' : ''}" title="${isPinned ? 'Unpin' : 'Pin to top'}" aria-label="${isPinned ? 'Unpin' : 'Pin to top'}">${ICON.pin}</button>`;
  el.addEventListener('click', (e) => openPR(p, true, e.metaKey || e.ctrlKey));
  el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); openPR(p, false, true); } });
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.key === 'Enter') { e.preventDefault(); openPR(p, true, e.metaKey || e.ctrlKey); }
    if (e.key === 'p') togglePin(p, accountLogin);
    if (e.key === 'u') (isUnread ? markRead([p.id]) : markUnread(p.id));
  });
  el.querySelector('.pin-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePin(p, accountLogin); });
  el.addEventListener('contextmenu', (e) => showMenu(e, [
    [isPinned ? 'Unpin' : 'Pin to top', () => togglePin(p, accountLogin)],
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
function showMenu(e,entries){
  e.preventDefault();const menu=$('menu');menu.innerHTML='';
  for(const entry of entries){
    if(entry==='-'){menu.append(document.createElement('hr'));continue;}
    if(entry.label){const label=document.createElement('div');label.className='menu-label';label.textContent=entry.label;menu.append(label);continue;}
    const [label,fn,checked]=entry,b=document.createElement('button');b.setAttribute('role',entry.length>2?'menuitemcheckbox':'menuitem');
    if(entry.length>2)b.setAttribute('aria-checked',String(checked));
    b.innerHTML=`<span class="check">${checked?ICON.check:''}</span><span>${esc(label)}</span>`;
    b.addEventListener('click',()=>{menu.hidden=true;fn();});menu.append(b);
  }
  menu.hidden=false;menu.style.left=Math.max(8,Math.min(e.clientX,innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=Math.max(8,Math.min(e.clientY,innerHeight-menu.offsetHeight-8))+'px';
  menu.querySelector('button')?.focus();
}
document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });

async function refresh() {
  $('refresh').classList.add('spinning');
  try { await chrome.runtime.sendMessage({ type: 'sync' }); }
  catch { state = { ...state, error: 'Could not refresh. Reload PR Sidebar in chrome://extensions and try again.' }; render(); }
  finally { $('refresh').classList.remove('spinning'); }
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
const openGitHub = () => chrome.tabs.create({ url: 'https://github.com/pulls/authored' });
$('signin').addEventListener('click', openGitHub);
$('account').addEventListener('click', openGitHub);
$('retry').addEventListener('click', refresh);

// ---------- Toolbar ----------

$('filter').addEventListener('input', render);
$('filter').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('filter').value = ''; render(); $('filter').blur(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('menu').hidden = true; quick = null; render(); }
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $('filter').focus(); }
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) refresh();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const selector = $('menu').hidden ? '#folders .folder-row, #folders .folder:not(.collapsed) .item' : '#menu button';
    const stops = [...document.querySelectorAll(selector)];
    if (!stops.length) return;
    e.preventDefault();
    const i = stops.indexOf(document.activeElement);
    stops[i < 0 ? 0 : Math.max(0, Math.min(stops.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  }
});

const SHORT_RANGE = { 1: '24 hours', 3: '3 days', 7: '1 week', 14: '2 weeks', 30: '1 month', 90: '3 months', 0: 'Any time' };
$('range').innerHTML = TIME_RANGES.map(([d, label]) => `<option value="${d}" title="${label}">${SHORT_RANGE[d] || label}</option>`).join('');
$('range').addEventListener('change', async () => {
  const days = Number($('range').value);
  settings = { ...settings, timeRangeDays: days };
  render(); // Filtering is immediate; saving the preference is the only async work.
  const latest = await getSettings();
  await chrome.storage.local.set({ settings: { ...latest, timeRangeDays: days } });
});

$('view').addEventListener('click', e => {
  e.stopPropagation();
  const r = $('view').getBoundingClientRect();
  const toggle = key => () => { view[key] = !view[key]; chrome.storage.local.set({ view }); render(); };
  const pins = Object.values(pinned).filter(p => !p.accountLogin || p.accountLogin === state?.viewer?.login);
  const repos = [...new Set([...Object.values(state?.sections || {}).flat(), ...pins].map(p => p.repo))].sort();
  showMenu({ preventDefault() {}, clientX: r.right - 220, clientY: r.bottom + 6 }, [
    ['Group by repository', toggle('groupByRepo'), view.groupByRepo],
    ['Hide drafts', toggle('hideDrafts'), view.hideDrafts],
    '-', { label: 'Repositories' },
    ...repos.map(repo => [repo, () => {
      view.hiddenRepos = view.hiddenRepos.includes(repo) ? view.hiddenRepos.filter(r => r !== repo) : [...view.hiddenRepos, repo];
      chrome.storage.local.set({ view }); render();
    }, !view.hiddenRepos.includes(repo)]),
    '-',
    ['Mark everything as read', () => markRead([...unreadIds(state, seen)])],
    ['Edit folders…', openSettings],
    ['Open GitHub', openGitHub],
  ]);
});

// ---------- Live updates ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.state) {
    if (state?.viewer?.login !== changes.state.newValue?.viewer?.login || changes.state.newValue?.needsLogin) {
      $('menu').hidden = true; $('menu').innerHTML = ''; quick = null;
    }
    state = changes.state.newValue;
  }
  if (changes.seen) seen = changes.seen.newValue || {};
  if (changes.pinned) pinned = changes.pinned.newValue || {};
  if (changes.settings) {
    settings = changes.settings.newValue;
    $('range').value = String(settings?.timeRangeDays ?? 0);
    applyAccent(settings?.groupColor);
  }
  if (changes.state || changes.seen || changes.pinned || changes.settings) render();
});
chrome.tabs.onActivated.addListener(trackActiveTab);
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.url && tab.active) trackActiveTab(); });
setInterval(render, 60_000);

(async () => {
  const data = await chrome.storage.local.get(['state', 'seen', 'pinned', 'view', COLLAPSE_KEY]);
  settings = await getSettings();
  state = data.state?.authMethod === 'browser' ? data.state : null;
  pinned = state ? data.pinned || {} : {};
  seen = state ? data.seen || {} : {};
  view = { ...view, ...data.view };
  collapsed = data[COLLAPSE_KEY] || {};
  $('range').value = String(settings.timeRangeDays);
  applyAccent(settings.groupColor);
  await trackActiveTab();
  const stale = !state?.lastSync || Date.now() - state.lastSync >= settings.intervalMinutes * 60000;
  if (stale || state?.cacheVersion !== 1) refresh();
})();
