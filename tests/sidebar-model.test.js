import test from 'node:test';
import assert from 'node:assert/strict';
import { livePRs } from '../sidebar-model.js';
test('one flat list deduplicates categories, keeps pins first, and sorts numerically by update time',()=>{
 const a={id:'a',updatedAt:'2026-11-01T00:00:00Z'},b={id:'b',updatedAt:'2026-11-03T00:00:00Z'},c={id:'c',updatedAt:'2026-11-02T00:00:00Z'};
 assert.deepEqual(livePRs({sections:{created:[a,b],review:[b,c],'custom:x':[{id:'other'}]}},{a}).map(p=>p.id),['a','b','c']);
});
test('relationship tags survive deduplication and pins from a different account stay hidden',()=>{
 const p={id:'a',updatedAt:'2026-11-01T00:00:00Z'};
 const result=livePRs({viewer:{login:'bob'},sections:{created:[p],review:[p]}},{old:{id:'old',accountLogin:'alice'}});
 assert.equal(result.length,1);assert.deepEqual(result[0].relations,['created','review']);
});
