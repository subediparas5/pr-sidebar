import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { buildFolders, DEFAULT_SETTINGS } from '../github.js';

const now = Date.now();
const pr = (id, days, reason) => ({id,number:1,title:`PR ${id}`,url:`https://github.com/acme/app/pull/${id}`,repo:'acme/app',repoAvatar:'https://github.com/acme.png',author:'alice',authorAvatar:'',createdAt:new Date(now-days*864e5).toISOString(),updatedAt:new Date(now-days*864e5).toISOString(),state:'OPEN',isDraft:false,ci:'SUCCESS',reason});
const fresh={...pr('1',0.1),reviewDecision:'APPROVED'},old=pr('2',12);
const initial={settings:{...DEFAULT_SETTINGS,sessionVersion:1,folderLayoutVersion:1,showAttention:true,timeRangeDays:7},state:{authMethod:'browser',cacheVersion:1,viewer:{login:'alice',avatarUrl:'https://github.com/alice.png'},sections:{created:[fresh,old],review:[old]},attention:[old,{...fresh,reason:'ready'}],order:['review','created'],titles:{created:'Created by me',review:'Review requested'},lastSync:now},seen:{'1':true},pinned:{}};
let db,events,requests,document;
async function mount(overrides={}) {
 const dom=parseHTML(readFileSync(new URL('../sidepanel.html',import.meta.url),'utf8'));
 document=dom.document;globalThis.document=document;globalThis.window=dom.window;
 globalThis.innerWidth=360;globalThis.innerHeight=650;
 // linkedom's select.value is read-only; emulate the browser's settable value.
 Object.defineProperty(dom.window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){this.querySelectorAll('option').forEach(o=>o.toggleAttribute('selected',o.value===String(v)));},configurable:true});
 db=structuredClone({...initial,...overrides});events=[];requests=[];
 globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(db[k])])),set:async values=>{const changes={};for(const[k,v]of Object.entries(values)){changes[k]={oldValue:db[k],newValue:v};db[k]=v;}events.forEach(fn=>fn(changes,'local'));}},onChanged:{addListener:fn=>events.push(fn)}},runtime:{sendMessage:async msg=>{requests.push(msg);return {ok:true};},getURL:p=>`chrome-extension://test/${p}`,openOptionsPage:async()=>{}},tabs:{query:async()=>[],onActivated:{addListener(){}},onUpdated:{addListener(){}}}};
 await import(`../sidepanel.js?test=${Math.random()}`);
 await new Promise(setImmediate);
 return dom.window;
}
const interval=globalThis.setInterval;
test.before(()=>{globalThis.setInterval=()=>0;});
test.after(()=>{globalThis.setInterval=interval;});

test('background queries fill an all-date cache independently of selected time range',()=>{
 const recent=buildFolders({...DEFAULT_SETTINGS,timeRangeDays:1},'alice');
 const all=buildFolders({...DEFAULT_SETTINGS,timeRangeDays:0},'alice');
 assert.deepEqual(recent,all);
 assert(!recent.some(f=>/updated:>=/.test(f.query)));
});
test('shows reference header, quick filters and folder metadata within the selected range',async()=>{
 await mount();
 assert(document.querySelector('header #avatar'));
 assert.match(document.querySelector('#status').textContent,/Updated/);
 assert.equal(document.querySelector('#folders .folder').dataset.key,'review');
 assert(!document.querySelector('[data-key="attention"]'),'attention folder should be absent');
 assert(document.querySelector('.pr-avatar img'));
 assert(document.querySelector('.node'));
 assert.match(document.querySelector('[data-key="created"] .meta').textContent,/app.*#1.*alice/);
 assert.equal(document.querySelectorAll('#stats button').length,4);
});
test('time changes filter the cache immediately with zero network or sync requests',async()=>{
 const win=await mount();
 assert.equal(requests.length,0,'fresh cache should render without fetching on open');
 const select=document.querySelector('#range');
 assert.equal(document.querySelector('[data-key="created"] .items').querySelectorAll('.item').length,1);
 assert(!document.querySelector('[data-key="attention"]'),'attention folder should be absent');
 assert.equal(document.querySelector('#stats [data-key="review"] .n').textContent,'0');
 assert.equal(document.querySelector('[data-key="review"] .folder-unread'),null);
 select.value='0';select.dispatchEvent(new win.Event('change'));
 await new Promise(setImmediate);
 assert.equal(document.querySelector('[data-key="created"] .items').querySelectorAll('.item').length,2);
 assert.equal(document.querySelector('[data-key="review"] .items').querySelectorAll('.item').length,1);
 assert.equal(document.querySelector('#stats [data-key="review"] .n').textContent,'1');
 assert.equal(document.querySelector('[data-key="review"] .folder-unread').textContent,'1 new');
 select.value='1';select.dispatchEvent(new win.Event('change'));
 await new Promise(setImmediate);
 assert.equal(document.querySelector('[data-key="created"] .items').querySelectorAll('.item').length,1);
 assert(!document.querySelector('[data-key="attention"]'),'attention folder should be absent');
 assert.equal(document.querySelector('#stats [data-key="review"] .n').textContent,'0');
 assert.equal(requests.length,0);
 assert.equal(db.state.sections.created.length,2,'view changes must not prune the cache');
 assert.equal(db.state.sections.review.length,1,'older PRs remain cached for Any time');
});
test('quick filters narrow category folders without adding a duplicate attention section',async()=>{
 const win=await mount();
 document.querySelector('#stats [data-key="ready"]').dispatchEvent(new win.Event('click'));
 assert.equal(document.querySelectorAll('#folders .folder').length,1);
 assert.equal(document.querySelectorAll('#folders .item').length,1);
 document.querySelector('#stats [data-key="ready"]').dispatchEvent(new win.Event('click'));
 assert.equal(document.querySelectorAll('#folders .folder').length,2);
 document.querySelector('#stats [data-key="review"]').dispatchEvent(new win.Event('click'));
 assert.equal(document.querySelectorAll('#folders .item').length,0);
 assert.match(document.querySelector('#folders').textContent,/No matches/);
});

test('repository menu can restore hidden pins after their repository leaves active folders',async()=>{
 const pin={...pr('3',1),repo:'acme/archived',accountLogin:'alice'};
 const win=await mount({pinned:{'3':pin,'4':{...pin,id:'4',repo:'private/other-account',accountLogin:'bob'}},view:{hiddenRepos:['acme/archived']}});
 document.querySelector('#view').getBoundingClientRect=()=>({right:340,bottom:100});
 document.querySelector('#view').dispatchEvent(new win.Event('click'));
 const menu=document.querySelector('#menu');
 assert(!menu.textContent.includes('private/other-account'));
 const repository=[...menu.querySelectorAll('button')].find(b=>b.textContent.includes('acme/archived'));
 assert(repository,'pinned-only repository must remain in the menu');
 repository.dispatchEvent(new win.Event('click'));
 assert.equal(document.querySelector('[data-key="pinned"] .item .repo').textContent,'archived');
});

test('closed PRs show their terminal state before prior review decisions',async()=>{
 const closed={...fresh,state:'CLOSED',reviewDecision:'APPROVED'};
 await mount({state:{...initial.state,sections:{'custom:closed':[closed]},order:['custom:closed']}});
 const row=document.querySelector('[data-key="custom:closed"] .item');
 assert.equal(row.querySelector('.chip').textContent,'Closed');
 assert.match(row.getAttribute('aria-label'),/closed/i);
 assert.match(row.title,/closed/i);
});


test('status chips count matching PRs once and exclude old, closed and hidden repositories',async()=>{
 const approved={...fresh};
 const failed={...pr('3',0.1),ci:'FAILURE'};
 const changed={...pr('4',0.1),reviewDecision:'CHANGES_REQUESTED'};
 const closed={...failed,id:'5',state:'CLOSED'};
 const hidden={...failed,id:'6',repo:'acme/hidden'};
 const win=await mount({state:{...initial.state,sections:{review:[old],created:[approved,failed,changed,closed,hidden],'custom:duplicate':[approved,failed]},order:['review','created','custom:duplicate']},pinned:{old:{...failed,id:'old-pin',updatedAt:old.updatedAt,accountLogin:'alice'}},view:{hiddenRepos:['acme/hidden']}});
 const count=key=>document.querySelector(`#stats [data-key="${key}"] .n`).textContent;
 assert.deepEqual(['review','changes','failing','ready'].map(count),['0','1','1','1']);
 document.querySelector('#stats [data-key="failing"]').dispatchEvent(new win.Event('click'));
 assert(!document.querySelector('[data-key="attention"]'),'attention folder should be absent');
 assert(!document.querySelector('#folders [data-key="review"]'));
 assert(!document.querySelector('#folders [data-key="pinned"]'));
 assert.deepEqual([...document.querySelectorAll('#folders .item .title')].map(n=>n.textContent),['PR 3','PR 3']);
 assert.equal(requests.length,0);
});
