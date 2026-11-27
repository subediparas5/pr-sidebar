import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient } from '../github-session.js';
const page=(login='alice',prs=[])=>({viewer:{login,avatarUrl:''},prs,ssoOrgs:[],totalPages:1});
const response=(body,status=200,url='https://github.com/pulls/authored')=>({ok:status===200,status,url,text:async()=>JSON.stringify(body),json:async()=>body});

test('uses browser credentials, paginates, enriches statuses and shares duplicate queries',async()=>{
 const calls=[]; const pr={id:'PR_one',title:'One'};
 const client=createSessionClient({parse:JSON.parse,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/deferred?'))return response({payload:{pullsDashboardSurfaceContentDeferredData:{results:[{id:pr.id,reviewDecisionState:'APPROVED'}]}}});
  if(new URL(url).searchParams.get('page')==='2')return response(page('alice',[{id:'PR_two'}]));
  return response({...page('alice',[pr]),totalPages:2});
 }});
 await client.identify();
 const folders=await client.folders([{key:'a',query:'is:pr author:alice'},{key:'b',query:'is:pr author:alice'}]);
 assert.equal(folders.a.length,2); assert.deepEqual(folders.a,folders.b); assert.equal(folders.a[0].reviewDecision,'APPROVED');
 assert.equal(calls.length,4);
 for(const {url,options} of calls){assert.equal(new URL(url).origin,'https://github.com');assert.equal(options.credentials,'include');assert.equal(options.headers.Authorization,undefined);assert.equal(options.method,undefined);}
});
test('rejects login redirects, rate limiting and mid-sync identity changes',async()=>{
 for(const [r,pattern] of [[response({},200,'https://github.com/login?return_to=pulls'),/Sign in/],[response({},429),/limiting/]]){
  const c=createSessionClient({parse:JSON.parse,fetchImpl:async()=>r}); await assert.rejects(c.identify(),pattern);
 }
 let n=0;const c=createSessionClient({parse:JSON.parse,fetchImpl:async()=>response(page(n++?'bob':'alice'))});
 await c.identify();await assert.rejects(c.folders([{key:'a',query:'is:pr'}]),e=>e.code==='ACCOUNT_CHANGED');
});
test('status failure keeps rows but warns instead of inventing check or review state',async()=>{
 const c=createSessionClient({parse:JSON.parse,fetchImpl:async(url)=>url.includes('/deferred?')?response({},500):response(page('alice',[{id:'PR_1',ci:null}]))});
 await c.identify();const f=await c.folders([{key:'a',query:'is:pr'}]);assert.equal(f.a.length,1);assert.equal(f.a[0].ci,null);assert.equal(c.warnings.length,1);
});
