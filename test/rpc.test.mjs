import {test} from 'node:test';import assert from 'node:assert/strict';import {rpc} from '../src/capital.js';
test('read-only RPC fails over with independent Base verification and backs off the failed endpoint',async()=>{
 const before=globalThis.fetch,seen=[];globalThis.fetch=async(url,init)=>{const q=JSON.parse(init.body);seen.push([url,q.method]);return url.includes('limited')?new Response('',{status:429}):Response.json({result:q.method==='eth_chainId'?'0x2105':'0x123'});};
 try{const env={BASE_RPC:'https://limited.invalid',BASE_RPC_FALLBACK:'https://healthy.invalid'};assert.equal(await rpc(env,'eth_blockNumber',[]),'0x123');assert.equal(await rpc(env,'eth_blockNumber',[]),'0x123');assert.equal(seen.filter(([u])=>u.includes('limited')).length,1);assert.ok(seen.some(([u,m])=>u.includes('healthy')&&m==='eth_chainId'));}finally{globalThis.fetch=before;}
});
test('wrong chain and contract errors fail closed rather than being masked by fallback',async()=>{
 const before=globalThis.fetch;try{
 globalThis.fetch=async()=>Response.json({result:'0x1'});await assert.rejects(rpc({BASE_RPC:'https://wrong.invalid'},'eth_chainId',[]),e=>e.status===409);
 globalThis.fetch=async(_u,i)=>Response.json(JSON.parse(i.body).method==='eth_chainId'?{result:'0x2105'}:{error:{code:3,message:'reverted'}});
 await assert.rejects(rpc({BASE_RPC:'https://revert.invalid',BASE_RPC_FALLBACK:'https://never.invalid'},'eth_call',[]),e=>e.status===502);
 }finally{globalThis.fetch=before;}
});
test('concurrent identical reads and chain verification are coalesced without caching results',async()=>{
 const original=globalThis.fetch,seen=[];let active=0,peak=0;
 globalThis.fetch=async(_url,init)=>{active++;peak=Math.max(peak,active);const q=JSON.parse(init.body);seen.push(q.method);await new Promise(r=>setTimeout(r,2));active--;return Response.json({result:q.method==='eth_chainId'?'0x2105':'0x123'});};
 try{const env={BASE_RPC:'https://coalesce.invalid'};await Promise.all(Array.from({length:20},()=>rpc(env,'eth_blockNumber',[])));assert.deepEqual(seen,['eth_chainId','eth_blockNumber']);await Promise.all([rpc(env,'eth_getCode',['a']),rpc(env,'eth_getCode',['b'])]);assert.equal(peak,1);await rpc(env,'eth_blockNumber',[]);assert.equal(seen.filter(m=>m==='eth_blockNumber').length,2);}finally{globalThis.fetch=original;}
});
test('a third provider is independently verified and no send method enters retries',async()=>{
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async(url,init)=>{sends++;const q=JSON.parse(init.body);return url.includes('third')?Response.json({result:q.method==='eth_chainId'?'0x2105':'0x999'}):new Response('',{status:429,headers:{'retry-after':'60'}})};
 try{const env={BASE_RPC:'https://first-limit.invalid',BASE_RPC_FALLBACK:'https://second-limit.invalid',BASE_RPC_SECONDARY:'https://third.invalid'};assert.equal(await rpc(env,'eth_blockNumber',[]),'0x999');const before=sends;await assert.rejects(rpc(env,'eth_sendRawTransaction',['0x00']),/read-only/);assert.equal(sends,before);}finally{globalThis.fetch=original;}
});
