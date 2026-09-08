import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fundingAvailability,fundingDirectory,poolSummary} from '../src/capital.js';
test('only open unfilled rounds accept deposits before deadline',()=>{
 assert.equal(fundingAvailability('0','101','9','10',100).depositEnabled,true);
 for(const values of [['0','100','9','10'],['0','101','10','10'],['1','101','0','10'],['2','101','0','10']])assert.equal(fundingAvailability(...values,100).status,'not-accepting');
});
test('empty verified round registry does not need RPC',async()=>{
 const data=await fundingDirectory({CAPITAL_DB:{prepare:()=>({all:async()=>({results:[]})})}});
 assert.deepEqual(data.items,{});
});

test('pool sums custody assets exactly and keeps missing rounds unknown',()=>{
 const r={balances:{pooled:'9007199254740993',cash:'9007199254740990',idleAssets:'2',budgetCash:'1',outstanding:'40',debt:'30',distributed:'5'}};
 assert.equal(poolSummary([r,r]).totals.pooled,'18014398509481986');
 const partial=poolSummary([r,{status:'unknown'}]);assert.equal(partial.totals,null);assert.equal(partial.verifiedSubtotal.pooled,r.balances.pooled);
 assert.equal(poolSummary([]).totals.pooled,'0');
});
