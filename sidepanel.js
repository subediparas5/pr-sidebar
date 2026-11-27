import { SECTIONS, TIME_RANGES, getSettings, markRead, markUnread, unreadIds, togglePin } from './github.js';
import { livePRs } from './sidebar-model.js';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const svg = body => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const ICON = {
  folder: svg('<path d="M1.5 4a1 1 0 0 1 1-1h4l1.5 2h5.5a1 1 0 0 1 1 1l-1 6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"/><path d="m6 8 2 2 2-2"/>'),
  pr: svg('<circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/><path d="M4 4.5v7M12 11.5V6a3 3 0 0 0-3-3H8M9.5 1.5 8 3l1.5 1.5"/>'),
  merged: svg('<circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="9" r="1.5"/><path d="M4 4.5v7M4 5c0 3 3 4 6.5 4"/>'),
  check: svg('<path d="m3 8 3 3 7-7"/>'), x: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  dot: svg('<circle cx="8" cy="8" r="2" fill="currentColor"/>'),
  pin: svg('<path d="m10 2 4 4-3 1-3 3v3L3 8h3l3-3zM5 11l-3 3"/>'),
  chev: '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="m3 4 2 2 2-2"/></svg>',
};
let state, settings, seen = {}, pinned = {}, collapsed = {}, currentUrl = '';
let view = { groupByRepo: false, hideDrafts: false, hiddenRepos: [] };
const colors = { blue:'#7772c4',purple:'#8872c7',grey:'#7e8190',red:'#bc6e83',green:'#68a28c',yellow:'#bca566',pink:'#bc7fa9',cyan:'#6d9daa',orange:'#c58c6f' };
const sameUrl = (tabUrl, prUrl) => !!tabUrl && (tabUrl === prUrl || ['/', '#', '?'].some(s => tabUrl.startsWith(prUrl+s)));

function render() {
  const login = !!state?.needsLogin;
  $('empty').hidden = !login; $('app').hidden = login;
  $('error').hidden = !state?.error; $('error').textContent = state?.error || '';
  $('warning').hidden = !state?.warnings?.length; $('warning').textContent = (state?.warnings || []).join(' ');
  const blocked = state?.blockedOrgs || [];
  $('orgs').hidden = !blocked.length;
  $('orgs').innerHTML = blocked.map(o => `<p><b>${esc(o.login)}</b> needs SSO. <a href="https://github.com/orgs/${encodeURIComponent(o.login)}/sso" target="_blank" rel="noreferrer">Sign in on GitHub</a>, then refresh.</p>`).join('');
  $('avatar').hidden = !state?.viewer;
  if (state?.viewer) $('avatar').src = state.viewer.avatarUrl;
  $('status').textContent = login ? 'Sign in on GitHub' : state?.viewer ? `@${state.viewer.login}` : 'Connecting to GitHub…';
  $('account').title = state?.lastSync ? `Last updated ${new Date(state.lastSync).toLocaleTimeString()}. Open GitHub.` : 'Open GitHub';
  const root = $('folders'); root.innerHTML = '';
  if (login) return;
  if (!state?.sections) { root.innerHTML = state?.error ? '<div class="folder-empty">Open GitHub or refresh to try again.</div>' : '<div class="skeleton"></div>'.repeat(4); return; }
  const unread = unreadIds(state, seen);
  const q = $('filter').value.trim().toLowerCase();
  const matches = p => (!view.hideDrafts || !p.isDraft) && !view.hiddenRepos.includes(p.repo) && (!q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q));
  root.append(renderFolder('live','Pull Requests',livePRs(state,pinned).filter(matches),unread,true));
  if (settings?.showAttention) root.append(renderFolder('attention','Needs your attention',(state.attention || []).filter(matches),unread));
  for (const key of state.order || []) if (key.startsWith('custom:')) root.append(renderFolder(key,state.titles[key],state.sections[key].filter(matches),unread));
}
function renderFolder(key,title,prs,unread,isRoot=false) {
  const folder = document.createElement('section');
  folder.className = 'folder' + (collapsed[key] ? ' collapsed' : '');
  const n = prs.filter(p=>unread.has(p.id)).length;
  folder.innerHTML = `<div class="folder-row" role="button" tabindex="0" aria-expanded="${!collapsed[key]}">
    <span class="folder-glyph">${ICON.folder}</span><span class="folder-name">${esc(title)}</span>
    ${n ? `<span class="folder-unread" title="${n} unread" aria-label="${n} unread"></span>` : ''}
    <span class="folder-count">${prs.length || ''}</span>${ICON.chev}
    <button class="icon-btn folder-menu" aria-label="${esc(title)} options" title="Folder options">⋯</button></div><div class="items"></div>`;
  const row = folder.querySelector('.folder-row');
  const toggle = () => { collapsed[key] = !collapsed[key]; chrome.storage.local.set({collapsedFolders:collapsed}); render(); };
  row.addEventListener('click',toggle);
  row.addEventListener('keydown',e=>{ if(e.target===row && ['Enter',' '].includes(e.key)){e.preventDefault();toggle();} });
  const openMenu = e => {
    e.stopPropagation();
    const r=row.getBoundingClientRect();
    const event=e.type==='contextmenu'?e:{preventDefault(){},clientX:r.left+12,clientY:r.bottom};
    if(isRoot) folderMenu(event);
    else showMenu(event,[['Mark all as read',()=>markRead(prs.map(p=>p.id))],['Open all in tab group',()=>openAll(prs)]]);
  };
  row.addEventListener('contextmenu',openMenu);
  folder.querySelector('.folder-menu').addEventListener('click',openMenu);
  const items=folder.querySelector('.items');
  if(!prs.length) items.innerHTML=`<div class="folder-empty">${$('filter').value ? 'No matching pull requests' : 'No pull requests in this view'}</div>`;
  let lastRepo;
  const sorted=view.groupByRepo?[...prs].sort((a,b)=>a.repo.localeCompare(b.repo)):prs;
  for(const p of sorted){
    if(view.groupByRepo && p.repo!==lastRepo){const h=document.createElement('div');h.className='repo-head';h.textContent=p.repo;items.append(h);lastRepo=p.repo;}
    items.append(renderItem(p,unread));
  }
  // Arc peeks unread/current tabs out of a collapsed Live Folder.
  if(collapsed[key]){
    const peek=document.createElement('div');peek.className='peek';
    prs.filter(p=>unread.has(p.id)||sameUrl(currentUrl,p.url)).slice(0,3).forEach(p=>peek.append(renderItem(p,unread)));
    folder.append(peek);
  }
  return folder;
}
const RELATIONS = { review: 'Needs your review', team: 'Team review', created: 'Opened by you', assigned: 'Assigned to you', mentioned: 'Mentioned you', reviewed: 'Reviewed by you', merged: 'Merged' };
function renderItem(p,unread){
  const accountLogin = state?.viewer?.login;
  const el=document.createElement('div'),isUnread=unread.has(p.id);
  const status=[p.isDraft?'Draft':p.state, p.reviewDecision?.replaceAll('_',' ').toLowerCase(),p.ci?`Checks: ${p.ci.toLowerCase()}`:''].filter(Boolean).join(' · ');
  el.className=`item ${isUnread?'unread':''}${sameUrl(currentUrl,p.url)?' current':''}`;
  el.tabIndex=0;el.setAttribute('role','link');el.setAttribute('aria-label',`${isUnread?'Unread: ':''}${p.title}, ${p.repo} #${p.number}, ${status}`);
  el.title=`${p.title}\n${p.repo} #${p.number} by ${p.author}\n${status}\nUpdated ${new Date(p.updatedAt).toLocaleString()}`;
  const relations = [...(p.relations || (p.author === accountLogin ? ['created'] : []))];
  if (p.reason === 'review' && !relations.includes('review')) relations.unshift('review');
  const tags = relations.map(k => `<span class="tag tag-${k}">${esc(RELATIONS[k] || k)}</span>`).join('') + (p.isDraft ? '<span class="tag">Draft</span>' : '');
  el.innerHTML=`<span class="pr-icon ${p.isDraft?'draft':p.state.toLowerCase()}">${p.state==='MERGED'?ICON.merged:ICON.pr}</span>
    <span class="row-copy"><span class="title">${esc(p.title)}</span><span class="tags">${tags}</span></span>${pinned[p.id]?`<span class="pin-mark">${ICON.pin}</span>`:''}
    <span class="row-status">${p.reviewDecision==='APPROVED'?`<span class="review-approved" title="Approved">${ICON.check}</span>`:p.reviewDecision==='CHANGES_REQUESTED'?`<span class="review-changes" title="Changes requested">${ICON.x}</span>`:''}
    ${p.ci?`<span class="ci-${p.ci}" title="Checks: ${p.ci.toLowerCase()}">${p.ci==='SUCCESS'?ICON.check:['FAILURE','ERROR'].includes(p.ci)?ICON.x:ICON.dot}</span>`:''}</span>
    ${isUnread?'<span class="unread-dot" aria-hidden="true"></span>':''}`;
  el.addEventListener('click',e=>openPR(p,true,e.metaKey||e.ctrlKey));
  el.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();openPR(p,false,true);}});
  el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openPR(p,true,e.metaKey||e.ctrlKey);}if(e.key==='p')togglePin(p,accountLogin);if(e.key==='u')isUnread?markRead([p.id]):markUnread(p.id);});
  el.addEventListener('contextmenu',e=>showMenu(e,[
    [pinned[p.id]?'Unpin':'Pin',()=>togglePin(p,accountLogin)],
    [isUnread?'Mark as read':'Mark as unread',()=>isUnread?markRead([p.id]):markUnread(p.id)],'-',
    ['Copy link',()=>navigator.clipboard.writeText(p.url)],['Open in new window',()=>{markRead([p.id]);chrome.windows.create({url:p.url});}],
  ]));
  return el;
}
async function folderMenu(e){
  const repos=[...new Set(livePRs(state,pinned).map(p=>p.repo))].sort();
  const toggleView=k=>()=>{view[k]=!view[k];saveView();};
  showMenu(e,[['Refresh',refresh],'-',
    ...['created','review','team','assigned','mentioned','reviewed','merged'].map(k=>[
      {created:'Created by Me',review:'Review Requests',team:'Team Review Requests'}[k]||SECTIONS[k].title,
      async()=>{settings.sections[k]=!settings.sections[k];await chrome.storage.local.set({settings});refresh();},!!settings.sections[k]]),
    '-',{label:'Repositories'},
    ...(repos.length?repos.map(repo=>[repo,()=>{view.hiddenRepos=view.hiddenRepos.includes(repo)?view.hiddenRepos.filter(r=>r!==repo):[...view.hiddenRepos,repo];saveView();},!view.hiddenRepos.includes(repo)]):[{label:'Available from your active pull requests'}]),
    '-', ['Group by repository',toggleView('groupByRepo'),view.groupByRepo],['Hide drafts',toggleView('hideDrafts'),view.hideDrafts],
    ['Search and time range…',showSearch],['Mark all as read',()=>markRead([...unreadIds(state,seen)])],['Edit folders…',openSettings],
  ]);
}
function saveView(){chrome.storage.local.set({view});render();}
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
async function openAll(prs){for(const p of prs)await openPR(p,false);}
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

async function refresh(){
  $('refresh').classList.add('spinning');
  try{await chrome.runtime.sendMessage({type:'sync'});}
  catch{state={...state,error:'Could not refresh. Reload PR Sidebar in chrome://extensions and try again.'};render();}
  finally{$('refresh').classList.remove('spinning');}
}
async function openSettings(){await chrome.runtime.openOptionsPage();}
const openGitHub=()=>chrome.tabs.create({url:'https://github.com/pulls/authored'});
function showSearch(){$('toolbar').hidden=false;$('filter').focus();}
function closeSearch(){$('filter').value='';$('filter').blur();render();}
async function trackActiveTab(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});currentUrl=t?.url||'';render();}
$('signin').addEventListener('click',openGitHub);$('account').addEventListener('click',openGitHub);
$('retry').addEventListener('click',refresh);$('refresh').addEventListener('click',refresh);
$('settings').addEventListener('click',openSettings);$('search').addEventListener('click',showSearch);
$('close-search').addEventListener('click',closeSearch);$('filter').addEventListener('input',render);
$('range').innerHTML=TIME_RANGES.map(([d,label])=>`<option value="${d}">${label}</option>`).join('');
$('range').addEventListener('change',async()=>{settings.timeRangeDays=Number($('range').value);await chrome.storage.local.set({settings});refresh();});
document.addEventListener('click',e=>{if(!$('menu').contains(e.target))$('menu').hidden=true;});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('menu').hidden=true;closeSearch();return;}
  if(e.target.matches('input,select,textarea'))return;
  if(e.key==='/'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();showSearch();}
  if(e.key==='r'&&!e.metaKey&&!e.ctrlKey)refresh();
  if(['ArrowDown','ArrowUp'].includes(e.key)){
    const selector=$('menu').hidden?'#folders .folder-row, #folders .item':'#menu button';
    const items=[...document.querySelectorAll(selector)].filter(el=>el.getClientRects().length);
    if(!items.length)return;e.preventDefault();const index=items.indexOf(document.activeElement);
    items[index<0?0:Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowDown'?1:-1)))].focus();
  }
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.state){
    if(state?.viewer?.login !== changes.state.newValue?.viewer?.login || changes.state.newValue?.needsLogin) { $('menu').hidden=true; $('menu').innerHTML=''; }
    state=changes.state.newValue;
  }
  if(changes.seen)seen=changes.seen.newValue||{};
  if(changes.pinned)pinned=changes.pinned.newValue||{};
  if(changes.settings){settings=changes.settings.newValue;$('range').value=String(settings?.timeRangeDays||0);document.documentElement.style.setProperty('--accent',colors[settings?.groupColor]||colors.blue);}
  if(changes.state||changes.seen||changes.pinned||changes.settings)render();
});
chrome.tabs.onActivated.addListener(trackActiveTab);
chrome.tabs.onUpdated.addListener((_id,info,tab)=>{if(info.url&&tab.active)trackActiveTab();});
(async()=>{
  const data=await chrome.storage.local.get(['state','seen','pinned','view','collapsedFolders']);
  settings=await getSettings();state=data.state?.authMethod==='browser'?data.state:null;
  pinned=state?data.pinned||{}:{};seen=state?data.seen||{}:{};
  view={...view,...data.view};collapsed=data.collapsedFolders||{};
  $('range').value=String(settings.timeRangeDays);document.documentElement.style.setProperty('--accent',colors[settings.groupColor]||colors.blue);
  await trackActiveTab();refresh();
})();
