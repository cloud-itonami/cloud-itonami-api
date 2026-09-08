import {ContractFactory,Interface,keccak256,toUtf8Bytes} from 'ethers';
import artifact from './launcher-artifact.json' with {type:'json'};
import {plan,address,failure,YIELD_POLICY,rpc,matchesRuntime,network} from './capital.js';
export const launcherABI=new Interface(artifact.abi);
// Prepare the one-time owner's grant; never broadcast or use a server key.
export async function prepareLauncher(env,input,principal){
 if(input.policy!==YIELD_POLICY||input.safe)throw failure(400,'Use the owner wallet and yield funding terms for the initial grant');
 const bot=address(input.executor);
 const owner=principal?.split(':').at(-1)?.toLowerCase();
 if(bot===owner)throw failure(400,'The operator Bot must have a dedicated executor');
 const p=await plan(env,{...input,action:'deploy'},principal);
 const s=p.metadata.settings;
 const args=[s.asset,s.aToken,s.pool,keccak256(toUtf8Bytes(s.project)),p.metadata.termsHash,s.fundingDeadline,s.maturity,s.dailyLimit,s.fundingCap,s.cashReserve,s.botShareBps];
 const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(bot,args,s.recipients);
 const result={...p,action:'deploy-launcher',transaction:{...p.transaction,data:tx.data},metadata:{...p.metadata,executor:bot},review:{...p.review,executor:bot,maximumRounds:1,operatorCreatesRound:true}};
 await env.CAPITAL_DB.prepare('UPDATE capital_intents SET action=?,payload=? WHERE id=? AND owner_id=?').bind(result.action,JSON.stringify({transaction:result.transaction,approval:null,metadata:result.metadata,review:result.review}),result.id,principal).run();
 return result;
}

export async function prepareOperatorLaunch(env,input,principal){
 const action=input.action==='operator-start'?'operator-start':'operator-launch';
 const row=await env.CAPITAL_DB.prepare('SELECT * FROM capital_launchers WHERE launcher=? AND owner_id=? AND project=?').bind(address(input.launcher),principal,input.project).first();
 if(!row)throw failure(403,'No owner-confirmed operator grant for this project');
 const code=await rpc(env,'eth_getCode',[row.launcher,'latest']);
 if(!matchesRuntime(code,'bot-funding-launcher-v1'))throw failure(409,'Operator grant implementation changed');
 const transaction={from:row.executor,to:row.launcher,data:launcherABI.encodeFunctionData(action==='operator-start'?'start':'launch',[]),chainId:'0x2105',value:'0x0'};
 try{await rpc(env,'eth_call',[transaction,'latest']);}catch{throw failure(409,'Grant cannot launch: revoked, expired, already used, or unavailable');}
 const createdVault=action==='operator-start'?address(launcherABI.decodeFunctionResult('vault',await rpc(env,'eth_call',[{to:row.launcher,data:launcherABI.encodeFunctionData('vault',[])},'latest']))[0]):undefined;
 const metadata={createdVault,launcher:row.launcher,executor:row.executor,settings:JSON.parse(row.settings),termsVersion:row.terms_version,termsHash:row.terms_hash};
 const id=crypto.randomUUID(),review={project:input.project,executor:row.executor,launcher:row.launcher,maximumRounds:1};
 await env.CAPITAL_DB.prepare('INSERT INTO capital_intents(id,owner_id,project,action,payload,created_at) VALUES(?,?,?,?,?,?)').bind(id,principal,input.project,action,JSON.stringify({transaction,metadata,review}),Date.now()).run();
 return {id,project:input.project,action,network,transaction,metadata,review,status:'prepared-not-executed',requiresOperatorSigner:true};
}

async function signerRequest(env,body){
 if(!env.FUNDING_SIGNER_TOKEN)throw failure(503,'Bot signer is not configured');
 const r=await fetch('https://signer.x402.nexus/internal/funding',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.FUNDING_SIGNER_TOKEN},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(90000)});
 if(r.status>=300&&r.status<400)throw failure(503,'Signer redirect refused');
 let data;try{data=await r.json();}catch{throw failure(503,'Bot signer unavailable');}
 if(!r.ok)throw failure(r.status,data.error||'Bot signer unavailable');return data;
}
export async function operatorStatus(env,project,principal){
 if(!principal)return null;
 const row=await env.CAPITAL_DB.prepare('SELECT launcher,executor FROM capital_launchers WHERE project=? AND owner_id=? ORDER BY created_at DESC LIMIT 1').bind(project,principal).first();
 if(!row)return null;
 try{return {...row,...await signerRequest(env,{action:'status',project,owner:principal,launcher:row.launcher})};}
 catch(error){return {...row,status:'unavailable',executionEnabled:false,error:error.message};}
}
export async function executeOperator(env,input,principal){
 const row=await env.CAPITAL_DB.prepare('SELECT * FROM capital_intents WHERE id=? AND owner_id=?').bind(input.id,principal).first();
 if(!row||!['operator-launch','operator-start'].includes(row.action))throw failure(403,'Owner-prepared operator action required');
 const expected=JSON.parse(row.payload);
 return signerRequest(env,{action:row.action==='operator-launch'?'launch':'start',project:row.project,owner:principal,launcher:expected.metadata.launcher});
}
