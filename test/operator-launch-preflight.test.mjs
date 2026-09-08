import test from 'node:test';import assert from 'node:assert/strict';
import {Interface,ZeroAddress,keccak256,toUtf8Bytes} from 'ethers';
import artifact from '../src/launcher-artifact.json' with {type:'json'};
import {preflight,pilot} from '../scripts/operator-launch-preflight.mjs';
const abi=new Interface(artifact.abi);
function mock(overrides={}){
 const calls=[];const values={owner:[pilot.owner],bot:[pilot.executor],vault:[ZeroAddress],revoked:[false],terms:[ZeroAddress,ZeroAddress,ZeroAddress,keccak256(toUtf8Bytes(pilot.project)),'0x'+'12'.repeat(32),2000n,3000n,1000000n,10000000n,0n,5000n],launch:['0x'+'34'.repeat(20)],...overrides};
 return {calls,rpc:async(method,params)=>{calls.push(method);switch(method){case 'eth_chainId':return '0x2105';case 'eth_getBlockByNumber':return {number:'0x10',hash:'0x'+'56'.repeat(32),timestamp:'0x3e8'};case 'eth_getCode':return artifact.runtime;case 'eth_call':{const fn=abi.parseTransaction({data:params[0].data}).name;return abi.encodeFunctionResult(fn,values[fn]);}case 'eth_getBalance':return '0x0';case 'eth_estimateGas':return '0x10000';case 'eth_gasPrice':return '0x10';default:throw Error('Forbidden RPC');}}};
}
test('prepares only an unsigned call and reports gas funding without enabling deposits',async()=>{const m=mock(),r=await preflight(m.rpc);assert.equal(r.gasFundingRequired,true);assert.equal(r.depositEnabled,false);assert.equal(r.signerConnected,false);assert.equal(r.transaction.data,abi.encodeFunctionData('launch',[]));assert.equal(r.transaction.value,'0x0');assert.equal(r.candidateVaultIsDepositAddress,false);assert.ok(!m.calls.some(x=>x.includes('send')||x.includes('sign')));});
test('rejects revoked, used, or differently owned grants',async()=>{for(const change of [{revoked:[true]},{vault:['0x'+'78'.repeat(20)]},{owner:['0x'+'90'.repeat(20)]}]){await assert.rejects(()=>preflight(mock(change).rpc));}});
