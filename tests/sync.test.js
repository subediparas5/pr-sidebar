import test from 'node:test';
import assert from 'node:assert/strict';
import { sync, getSettings, unreadIds } from '../github.js';
function storage(initial){let db=structuredClone(initial);globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(db[k])])),set:async v=>Object.assign(db,structuredClone(v))}},notifications:{create:()=>{throw Error('No first-run notifications');}}};return ()=>db;}
function client(login='alice',error){return {identify:async()=>{if(error)throw error;return {login,avatarUrl:''};},folders:async folders=>Object.fromEntries(folders.map(f=>[f.key,[]])),blockedOrgs:[],warnings:[]};}

test('migration removes credentials, keeps preferences and uses all dates',async()=>{
 const db=storage({settings:{token:'old-secret',authMethod:'oauth',groupColor:'purple',customFolders:[]},state:{viewer:{login:'alice'}},pinned:{old:{id:'old'}},seen:{old:true}});
 const s=await getSettings();assert.equal(s.token,undefined);assert.equal(s.authMethod,undefined);assert.equal(s.timeRangeDays,0);assert.equal(s.groupColor,'purple');
 await sync(client());assert.equal(db().settings.token,undefined);assert.deepEqual(db().pinned,{});assert.equal(db().state.authMethod,'browser');
});
test('account switch and sign-out discard private cached rows and pins',async()=>{
 const db=storage({settings:{sessionVersion:1},state:{viewer:{login:'alice'},authMethod:'browser',sections:{created:[{id:'private'}]}},pinned:{private:{id:'private'}},seen:{private:true},initialized:true});
 await sync(client('bob'));assert.equal(db().state.viewer.login,'bob');assert.deepEqual(db().pinned,{});assert.deepEqual(db().seen,{});
 await sync(client('bob',Object.assign(Error('Signed out'),{code:'SIGNED_OUT'})));assert.equal(db().state.needsLogin,true);assert.equal(db().state.viewer,undefined);
});
test('network failure preserves last successful sync timestamp, with an error',async()=>{
 const db=storage({settings:{sessionVersion:1},state:{viewer:{login:'alice'},authMethod:'browser',lastSync:123,sections:{}},initialized:true});
 await sync(client('alice',Error('Offline')));assert.equal(db().state.lastSync,123);assert.equal(db().state.error,'Offline');
});

test('a refresh requested during sync queues new settings instead of losing them',async()=>{
 const db=storage({settings:{sessionVersion:1,sections:{created:true,review:false,team:false,assigned:false}},state:{viewer:{login:'alice'},authMethod:'browser'},initialized:true});
 let release;const gate=new Promise(r=>release=r);let started;const ready=new Promise(r=>started=r);
 const first=client();const folders=first.folders;first.folders=async f=>{started();await gate;return folders(f);};
 const running=sync(first);await ready;
 await chrome.storage.local.set({settings:{...db().settings,sections:{created:false,review:true,team:false,assigned:false}}});
 const queued=sync(client());release();await Promise.all([running,queued]);
 assert.deepEqual(db().state.order,['review']);
});

test('stale account pin actions cannot add private PRs to the new account',async()=>{
 const {togglePin}=await import('../github.js');
 const db=storage({state:{viewer:{login:'bob'},authMethod:'browser'},pinned:{}});
 await togglePin({id:'private',title:'Private Alice PR'},'alice');
 assert.deepEqual(db().pinned,{});
});

test('changing a time filter does not forget read state for temporarily hidden PRs',async()=>{
 const db=storage({settings:{sessionVersion:1},state:{viewer:{login:'alice'},authMethod:'browser',sections:{created:[{id:'old'}]}},seen:{old:true},initialized:true});
 await sync(client());assert.equal(db().seen.old,true);
});

test('all-date cache migration baselines historical additions without hiding existing unread or new PRs',async()=>{
 const lastSync=Date.now()-60000;
 const existing={id:'unread',updatedAt:'2020-01-01T00:00:00Z'};
 const historical={id:'historical',updatedAt:'2020-01-01T00:00:00Z'};
 const recent={id:'new',updatedAt:new Date().toISOString(),repo:'acme/app',number:3,title:'New review',author:'bob',url:'https://github.com/acme/app/pull/3'};
 const db=storage({settings:{sessionVersion:1,timeRangeDays:7},state:{viewer:{login:'alice'},authMethod:'browser',lastSync,sections:{review:[existing]}},seen:{read:true},initialized:true});
 const notices=[];chrome.notifications.create=(id)=>notices.push(id);
 const c=client();c.folders=async folders=>Object.fromEntries(folders.map(f=>[f.key,f.key==='review'?[existing,historical,recent]:[]]));
 await sync(c);
 assert.equal(db().state.cacheVersion,1);
 assert.equal(db().seen.historical,true);
 assert.equal(db().seen.read,true);
 assert.equal(db().seen.unread,undefined);
 assert.equal(db().seen.new,undefined);
 assert.deepEqual(notices,[`pr-sidebar:new|${recent.url}`]);
});

test('removed attention folder does not add searches or unread badges for legacy cache entries',async()=>{
 const db=storage({settings:{sessionVersion:1,showAttention:true},state:{viewer:{login:'alice'},authMethod:'browser',sections:{review:[]},attention:[{id:'hidden'}]},initialized:true});
 assert.equal(unreadIds(db().state,{}).size,0);
 const c=client();const search=c.folders;let queries;
 c.folders=async folders=>{queries=folders;return search(folders);};
 await sync(c);
 assert(!queries.some(f=>f.key.startsWith('att:')));
 assert.equal((await getSettings()).showAttention,undefined);
});

test('status changes still notify for your PRs without attention-folder searches',async()=>{
 const mine={id:'mine',state:'OPEN',author:'alice',repo:'acme/app',title:'My PR',number:1,url:'https://github.com/acme/app/pull/1',updatedAt:new Date().toISOString(),ci:'SUCCESS'};
 const other={...mine,id:'other',author:'bob'};
 storage({settings:{sessionVersion:1},state:{viewer:{login:'alice'},authMethod:'browser',cacheVersion:1,sections:{created:[mine],'custom:other':[other]},attention:[{...mine,reason:'open'},{...other,reason:'open'}]},initialized:true});
 const notices=[];chrome.notifications.create=(id)=>notices.push(id);
 const c=client();c.folders=async folders=>Object.fromEntries(folders.map(f=>[f.key,f.key==='created'?[{...mine,ci:'FAILURE'},{...other,ci:'FAILURE'}]:[]]));
 await sync(c);
 assert.deepEqual(notices,[`pr-sidebar:mine|${mine.url}`]);
});
