import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
test('private capital handler rejects invalid bodies and registration without ingress authority',async()=>{
 for(const [body,status] of [['null',400],['[]',400],['{',400],[JSON.stringify({action:'register-terms'}),403]]){
 const r=await worker.fetch(new Request('https://capital.internal/capital',{method:'POST',headers:{'x-itonami-principal':'did:pkh:eip155:8453:0x'+'1'.repeat(40)},body}),{});assert.equal(r.status,status);
 }
 assert.equal((await worker.fetch(new Request('https://capital.internal/capital',{method:'POST',body:'{}'}),{})).status,401);
 assert.equal((await worker.fetch(new Request('https://capital.internal/capital?project=bad'),{})).status,400);
});
