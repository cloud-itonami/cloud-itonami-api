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
