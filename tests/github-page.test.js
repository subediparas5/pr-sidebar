import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { parseGitHubPage, applyDeferred } from '../github-page.js';

const row = { id:'PR_test', number:7, title:'Fix <unsafe> & quotes', permalink:'https://github.com/acme/app/pull/7', repoNameWithOwner:'acme/app', author:{displayLogin:'alice'}, state:'OPEN', isDraft:false, createdAt:'2026-10-01T00:00:00Z', updatedAt:'2026-11-01T00:00:00Z' };
const html = (rows=[row], extra={}) => `<meta name="user-login" content="alice"><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({payload:{pullsDashboardSurfaceLayoutRoute:{currentUser:{login:'alice',avatarUrl:'https://avatars.githubusercontent.com/u/1'},sso:{sso_organizations:[{login:'acme'}]}},pullsDashboardSurfaceContentRoute:{results:rows,pageInfo:{currentPage:1,totalPages:2,totalCount:30},error:null},...extra}})}</script>`;
const parse = text => parseGitHubPage(text,DOMParser);

test('parses authenticated dashboard, stable IDs, dates, safe text and SSO',()=>{
 const p=parse(html());
 assert.equal(p.viewer.login,'alice'); assert.equal(p.prs[0].id,'PR_test');
 assert.equal(p.prs[0].title,row.title); assert.equal(p.prs[0].updatedAt,row.updatedAt);
 assert.equal(p.totalPages,2); assert.deepEqual(p.ssoOrgs,[{login:'acme',reason:'sso'}]);
});
test('recognizes valid empty results and preserves merged/draft states',()=>{
 assert.deepEqual(parse(html([])).prs,[]);
 const p=parse(html([{...row,isDraft:true},{...row,id:'PR_merged',state:'CLOSED',mergedAt:'2026-11-01T00:00:00Z'}]));
 assert.equal(p.prs[0].isDraft,true); assert.equal(p.prs[1].state,'MERGED');
});
test('login and unexpected HTML never masquerade as an empty folder',()=>{
 assert.throws(()=>parse('<form action="/session"><input name="login"></form>'),e=>e.code==='SIGNED_OUT');
 assert.throws(()=>parse('<meta name="user-login" content="alice"><h1>Error</h1>'),/page format/i);
 assert.throws(()=>parse(html([], {pullsDashboardSurfaceContentRoute:{error:'Invalid query'}})),/Invalid query/);
});
test('rejects malformed PRs and off-site destinations rather than dropping records',()=>{
 assert.throws(()=>parse(html([{...row,permalink:'https://evil.example/pull/7'}])),/pull request/i);
 assert.throws(()=>parse(html([{...row,updatedAt:undefined}])),/pull request/i);
});
test('maps deferred checks and review states by ID; unknown data remains unknown',()=>{
 const prs=parse(html()).prs;
 const out=applyDeferred(prs,{payload:{pullsDashboardSurfaceContentDeferredData:{results:[{id:'PR_test',reviewDecisionState:'APPROVED',statusCheckRollup:{state:'SUCCESS'}}]}}});
 assert.equal(out[0].reviewDecision,'APPROVED'); assert.equal(out[0].ci,'SUCCESS');
 assert.equal(applyDeferred(prs,{payload:{pullsDashboardSurfaceContentDeferredData:{results:[]}}})[0].ci,null);
 assert.throws(()=>applyDeferred(prs,{}),/status data/i);
});
