import { sync, getSettings, unreadIds, markRead } from './github.js';

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const { intervalMinutes } = await getSettings();
  await chrome.alarms.clear('sync');
  chrome.alarms.create('sync', { periodInMinutes: Math.max(1, intervalMinutes) });
  sync();
}

chrome.runtime.onInstalled.addListener((details) => {
  setup();
});
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') sync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync') {
    sync().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'settingsChanged') {
    setup().then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function updateBadge() {
  const { state, seen } = await chrome.storage.local.get(['state', 'seen']);
  const n = unreadIds(state, seen).size;
  await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  await chrome.action.setBadgeText({ text: state?.error ? '!' : n ? String(n) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.state || changes.seen)) updateBadge();
});

// Clicking a notification opens the PR (or the sidebar's PRs for a summary notification).
chrome.notifications.onClicked.addListener(async (nid) => {
  chrome.notifications.clear(nid);
  if (!nid.startsWith('pr-sidebar:')) return;
  const [id, url] = nid.slice('pr-sidebar:'.length).split('|');
  if (!url) return;
  await markRead([id]);
  const win = await chrome.windows.getLastFocused();
  const tab = await chrome.tabs.create({ url, windowId: win.id, active: true });
  const { settings } = await chrome.storage.local.get('settings');
  const name = settings?.groupName || 'Pull Requests';
  const [group] = await chrome.tabGroups.query({ windowId: win.id, title: name });
  if (group) await chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
  else {
    const gid = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: win.id } });
    await chrome.tabGroups.update(gid, { title: name, color: settings?.groupColor || 'purple' });
  }
  await chrome.windows.update(win.id, { focused: true });
});
