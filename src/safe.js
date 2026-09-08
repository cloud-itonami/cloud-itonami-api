import {Interface,zeroPadValue,ZeroAddress} from 'ethers';
export const safeABI=new Interface([
 'function getOwners() view returns(address[])','function getThreshold() view returns(uint256)',
 'function VERSION() view returns(string)','function nonce() view returns(uint256)',
 'function getModulesPaginated(address,uint256) view returns(address[],address)',
 'function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)',
 'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)','event ExecutionFailure(bytes32 indexed txHash,uint256 payment)']);
// The owner signs the OUTER transaction. No ECDSA signature or key is fabricated.
// v=1 is Safe's documented sender-owner prevalidated signature, not a delegation.
export function safeEnvelope(safe,owner,inner){
 if(inner.value!=='0x0'||!inner.to)throw Error('Only zero-value calls to an existing contract');
 const signature=zeroPadValue(owner,32)+'0'.repeat(64)+'01';
 return {from:owner,to:safe,value:'0x0',chainId:'0x2105',data:safeABI.encodeFunctionData('execTransaction',
  [inner.to,0,inner.data,0,0,0,0,ZeroAddress,ZeroAddress,signature])};
}
export function safeExecutionSucceeded(receipt,safe){
 const events=receipt.logs.filter(l=>l.address?.toLowerCase()===safe.toLowerCase()).map(l=>{try{return safeABI.parseLog(l)?.name;}catch{return null;}});
 return events.filter(e=>e==='ExecutionSuccess').length===1&&!events.includes('ExecutionFailure');
}

// SafeL2 1.4.1 canonical deployment, verified against safe-global/safe-deployments.
export const safeDeployment={singleton:'0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
 singletonCodeHash:'0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff',
 proxyCodeHash:'0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'};
