import {Interface,keccak256,toUtf8Bytes,ZeroAddress,formatEther} from 'ethers';
import artifact from '../src/launcher-artifact.json' with {type:'json'};
import {matchesRuntime} from '../src/capital.js';
import {pathToFileURL} from 'node:url';
export const pilot={project:'cloud-itonami/cloud-itonami-isic-7320',launcher:'0x2a2c39d240c10f19a7f2c1971a1ba560d00ab413',owner:'0xe255d68563c974ac061484cece4e57de02a4e0da',executor:'0x025083fab44ac41db4e657bdf9963daa6bfca7e9'};
const abi=new Interface(artifact.abi);
export async function preflight(rpc,config=pilot){
 if(Number(await rpc('eth_chainId',[]))!==8453)throw Error('Wrong chain');
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 if(!block?.number||!block?.hash)throw Error('Missing block');
 const read=async(name)=>abi.decodeFunctionResult(name,await rpc('eth_call',[{to:config.launcher,data:abi.encodeFunctionData(name,[])},block.number]));
 if(!matchesRuntime(await rpc('eth_getCode',[config.launcher,block.number]),'bot-funding-launcher-v1'))throw Error('Unexpected grant implementation');
 const owner=(await read('owner'))[0],executor=(await read('bot'))[0],vault=(await read('vault'))[0];
 if(owner.toLowerCase()!==config.owner||executor.toLowerCase()!==config.executor)throw Error('Grant authority mismatch');
 if((await read('revoked'))[0])throw Error('Grant revoked');
 if(vault!==ZeroAddress)throw Error('Round already created; confirm existing round instead');
 const terms=await read('terms');
 if(terms.project!==keccak256(toUtf8Bytes(config.project)))throw Error('Project mismatch');
 if(terms.fundingEnd<=BigInt(block.timestamp))throw Error('Funding deadline passed');
 const transaction={from:executor,to:config.launcher,chainId:'0x2105',value:'0x0',data:abi.encodeFunctionData('launch',[])};
 // Read-only simulation. No key access, signing, broadcast, or ledger mutation.
 const simulated=abi.decodeFunctionResult('launch',await rpc('eth_call',[transaction,block.number]))[0];
 const gas=BigInt(await rpc('eth_estimateGas',[transaction]));
 const gasPrice=BigInt(await rpc('eth_gasPrice',[]));
 const balance=BigInt(await rpc('eth_getBalance',[executor,block.number]));
 return {status:'prepared-not-signed',project:config.project,checkedAtBlock:block.number,blockHash:block.hash,termsHash:terms.termsHash,transaction,simulation:'passed',candidateVault:simulated,candidateVaultIsDepositAddress:false,executorETH:formatEther(balance),estimatedExecutionGas:gas.toString(),observedGasPriceWei:gasPrice.toString(),executionFeeEstimateETH:formatEther(gas*gasPrice),feeEstimateExcludesL1DataFee:true,gasFundingRequired:balance<gas*gasPrice,signerConnected:false,depositEnabled:false};
}
async function rpc(method,params){
 if(!['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_getBalance'].includes(method))throw Error('Read-only RPC only');
 const res=await fetch('https://base.drpc.org',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('RPC unavailable: '+res.status);
 const body=await res.json();if(body.error||body.result===undefined)throw Error('RPC failed: '+method);return body.result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await preflight(rpc),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
