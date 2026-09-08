import {Interface,ContractFactory,keccak256,toUtf8Bytes} from 'ethers';
import artifact from './vault-artifact.json' with {type:'json'};
import yieldArtifact from './yield-vault-artifact.json' with {type:'json'};
export const YIELD_POLICY='yield-budget-v1';
const yieldABI=new Interface(yieldArtifact.abi);
export function deploymentArtifact(policy){if(policy===YIELD_POLICY)return yieldArtifact;if(policy==='fixed-round-net-income-v1')return artifact;throw failure(400,'Unsupported funding policy');}
export const network={chainId:8453,asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',pool:'0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',aToken:'0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',confirmations:12};
export const vault=new Interface(artifact.abi);
const erc20=new Interface(['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)']);
export const failure=(status,message)=>Object.assign(Error(message),{status});
export const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export const address=x=>{if(typeof x!=='string'||!/^0x[a-fA-F0-9]{40}$/.test(x)||/^0x0{40}$/.test(x))throw failure(400,'Invalid address');return x.toLowerCase();};
export function units(x){if(typeof x!=='string'||!/^\d{1,12}(\.\d{1,6})?$/.test(x))throw failure(400,'Use a positive USDC amount with at most six decimals');const [w,f='']=x.split('.');const n=BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));if(n<=0n)throw failure(400,'Positive amount required');return n;}
const hex=x=>'0x'+BigInt(x).toString(16);
const stringify=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
const hash=x=>keccak256(toUtf8Bytes(typeof x==='string'?x:stringify(x)));
const verifiedRPC=new Map(),unavailableRPC=new Map();
async function rpcAt(url,method,params){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw failure(503,'Chain unavailable');const result=await response.json();
 if(result.error)throw failure([429,-32005].includes(result.error.code)?503:502,'Chain call failed');if(result.result===undefined)throw failure(503,'Invalid chain response');return result.result;
}
export async function rpc(env,method,params){
 const endpoints=[...new Set([env.BASE_RPC,env.BASE_RPC_FALLBACK].filter(Boolean))];
 if(!endpoints.length||endpoints.some(x=>!x.startsWith('https://')))throw failure(503,'Base RPC is not configured');
 for(const url of endpoints){
  if((unavailableRPC.get(url)||0)>Date.now())continue;
  try{
   if(method!=='eth_chainId'&&(verifiedRPC.get(url)||0)<Date.now()){
    if(Number(await rpcAt(url,'eth_chainId',[]))!==network.chainId)throw failure(409,'Wrong RPC chain');
    verifiedRPC.set(url,Date.now()+30000);
   }
   const result=await rpcAt(url,method,params);
   if(method==='eth_chainId'){if(Number(result)!==network.chainId)throw failure(409,'Wrong RPC chain');verifiedRPC.set(url,Date.now()+30000);}
   return result;
  }catch(error){
   // A contract revert or wrong-chain response is never turned into success by another provider.
   if(error.status===502||error.status===409)throw error;
   unavailableRPC.set(url,Date.now()+30000);verifiedRPC.delete(url);
  }
 }
 throw failure(503,'Base RPC temporarily unavailable; retry shortly');
}
export async function chain(env){if(Number(await rpc(env,'eth_chainId',[]))!==network.chainId)throw failure(503,'Wrong RPC chain');}
const call=async(env,to,name,args=[],block='latest',abi=vault)=>abi.decodeFunctionResult(name,await rpc(env,'eth_call',[{to,data:abi.encodeFunctionData(name,args)},block]))[0];
const db=env=>{if(!env.CAPITAL_DB)throw failure(503,'Capital journal unavailable');return env.CAPITAL_DB;};
export function wallet(principal){const match=/^did:pkh:eip155:(1|8453):(0x[a-fA-F0-9]{40})$/.exec(principal||'');if(!match)throw failure(403,'Use a verified EVM wallet for financial transactions');return address(match[2]);}
async function terms(env,project,version){const row=await db(env).prepare('SELECT * FROM public_funding_terms WHERE project=? AND version=?').bind(project,version).first();if(!row)throw failure(404,'Registered terms not found');return row;}
async function round(env,project,contract){const row=await db(env).prepare('SELECT * FROM capital_rounds WHERE project=? AND vault=?').bind(project,address(contract)).first();if(!row)throw failure(404,'Verified lending round not found');return row;}
export async function snapshot(env,project,contract,principal){
 if(typeof project!=='string'||!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(project)||project.length>201)throw failure(400,'Use org/repo');
 const rows=(await db(env).prepare('SELECT project,vault,terms_version,created_at,settings FROM capital_rounds WHERE project=? ORDER BY created_at DESC').bind(project).all()).results;
 const selected=contract?rows.find(r=>r.vault===address(contract)):rows[0];if(contract&&!selected)throw failure(404,'Verified lending round not found');if(!selected)return {project,network,rounds:[],status:'no-vault',depositEnabled:false};
 await chain(env);
 const block=await rpc(env,'eth_blockNumber',[]),to=selected.vault,result={};
 await Promise.all(['phase','principal','debt','repaid','businessIncome','writtenOff','settlementAssets','distributed','fundingDeadline','maturity','dailyLimit','cashReserve','controller','termsHash'].map(async name=>{result[name]=String(await call(env,to,name,[],block));}));
 if(JSON.parse(selected.settings).policy===YIELD_POLICY){for(const name of ['budget','botShareBps','retainedYield','harvested','budgetAllocated','budgetSpent'])result[name]=String(await call(env,to,name,[],block,yieldABI));result.budgetCash=String(await call(env,network.asset,'balanceOf',[result.budget],block,erc20));}
 result.cash=String(await call(env,network.asset,'balanceOf',[to],block,erc20));result.idleAssets=String(await call(env,network.aToken,'balanceOf',[to],block,erc20));
 if(principal){try{result.position=String(await call(env,to,'positions',[wallet(principal)],block));}catch(error){if(error.status!==403)throw error;}}
 return {project,network,rounds:rows.map(r=>({...r,settings:JSON.parse(r.settings)})),vault:to,termsVersion:selected.terms_version,settings:JSON.parse(selected.settings),asOfBlock:block,status:'verified-vault',balances:result};
}
export async function plan(env,input,principal){
 await chain(env);const from=wallet(principal),project=input.project;
 if(typeof project!=='string'||!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(project)||project.length>201)throw failure(400,'Use org/repo');
 const usage=await db(env).prepare('SELECT count(*) AS n FROM capital_intents WHERE owner_id=? AND created_at>?').bind(principal,Date.now()-86400000).first();if(usage.n>=200)throw failure(429,'Daily transaction preparation limit reached');
 const action=input.action,id=crypto.randomUUID();let tx,approval=null,metadata={};
 if(action==='deploy'){
  const row=await terms(env,project,input.termsVersion);if(row.owner_id!==principal)throw failure(403,'Only the registering organization wallet can create its lending round');
  const declared=JSON.parse(row.terms);if(declared.chainId!==8453||declared.idleStrategy!=='aave-v3')throw failure(400,'This release supports Base USDC and Aave V3');
  const selectedArtifact=deploymentArtifact(input.policy);
  if(input.policy!==(declared.fundingPolicy||'fixed-round-net-income-v1'))throw failure(400,'Register terms for the selected funding model');
  const yieldMode=input.policy===YIELD_POLICY;
  if(yieldMode&&(!Number.isInteger(declared.botShareBps)||declared.botShareBps<1||declared.botShareBps>10000))throw failure(400,'Register Bot yield share from 1 to 10000 basis points');
  const now=Math.floor(Date.now()/1000),end=input.fundingDeadline,maturity=input.maturity;
  if(!Number.isSafeInteger(end)||!Number.isSafeInteger(maturity)||end<now+300||maturity<=end||maturity>now+365*86400)throw failure(400,'Use future funding and repayment deadlines within one year');
  const cap=units(input.fundingCap),daily=units(declared.dailyLimitUSDC),reserve=input.cashReserve==='0'?0n:units(input.cashReserve);
  if(reserve>cap||!Array.isArray(input.recipients)||!input.recipients.length||input.recipients.length>32)throw failure(400,'Specify a cash reserve and 1–32 approved payees');
  const recipients=[...new Set(input.recipients.map(address))];
  const settings={policy:input.policy,...(yieldMode?{botShareBps:declared.botShareBps}:{}),project,termsVersion:row.version,registeredTerms:declared,chainId:8453,asset:network.asset,pool:network.pool,aToken:network.aToken,controller:from,fundingDeadline:end,maturity,dailyLimit:daily.toString(),fundingCap:cap.toString(),cashReserve:reserve.toString(),recipients,graceSeconds:604800,lenderNetIncomeBps:yieldMode?10000-declared.botShareBps:10000};
  const termsHash=hash(settings);metadata={settings,termsHash,termsVersion:row.version};
  const factory=new ContractFactory(selectedArtifact.abi,selectedArtifact.bytecode);
  tx=await factory.getDeployTransaction(network.asset,network.aToken,network.pool,hash(project),termsHash,end,maturity,daily,cap,reserve,recipients,...(yieldMode?[declared.botShareBps]:[]));
 }else{
  const row=await round(env,project,input.vault),to=row.vault;metadata={vault:to,termsVersion:row.terms_version};
  let args=[],name=action,amount=0n;
  if(['deposit','withdraw','allocate','recall'].includes(action)){amount=units(input.amount);args=[amount];}
  if(action==='deposit')args.push(await call(env,to,'termsHash'));
  if(action==='spend'){amount=units(input.amount);if(!/^0x[a-fA-F0-9]{64}$/.test(input.intent||'')||/^0x0{64}$/.test(input.intent))throw failure(400,'A unique business invoice/task hash is required');args=[input.intent,address(input.recipient),amount];}
  if(action==='repay'){const p=input.principal==='0'?0n:units(input.principal),income=input.income==='0'?0n:units(input.income);if(p+income===0n)throw failure(400,'Positive repayment required');args=[p,income];amount=p+income;}
  if(action==='setExecutor'){if(typeof input.allowed!=='boolean')throw failure(400,'Explicit grant or revocation required');args=[address(input.executor),input.allowed];}
  if(!['deposit','withdraw','start','spend','repay','allocate','recall','settle','claim','setExecutor','harvest'].includes(action))throw failure(400,'Unsupported action');
  const roundPolicy=JSON.parse(row.settings).policy;
  if(action==='harvest'&&roundPolicy!==YIELD_POLICY)throw failure(400,'Harvest requires a yield-funded round');
  tx={to,data:(roundPolicy===YIELD_POLICY?yieldABI:vault).encodeFunctionData(name,args)};
  if(['deposit','repay'].includes(action)){
   const allowance=await call(env,network.asset,'allowance',[from,to],'latest',erc20);
   if(allowance<amount)approval={from,to:network.asset,data:erc20.encodeFunctionData('approve',[to,amount]),value:'0x0',chainId:hex(network.chainId)};
  }
 }
 const transaction={from,...tx,value:'0x0',chainId:hex(network.chainId)};
 if(action!=='deploy'&&!approval){try{await rpc(env,'eth_call',[{from,to:tx.to,data:tx.data,value:'0x0'},'latest']);}catch{throw failure(409,'Current balance, authority or round conditions do not permit this action');}}
 if(approval){const phase=Number(await call(env,tx.to,'phase'));if((action==='deposit'&&phase!==0)||(action==='repay'&&phase!==1))throw failure(409,'This round no longer accepts this action');}

 // Persist the exact transaction before the wallet sees it. No request can choose arbitrary calldata.
 const review=action==='deploy'?{fundingModel:input.policy,botShareBps:metadata.settings.botShareBps??null,controller:from,asset:'Base USDC',fundingCap:input.fundingCap,cashReserve:input.cashReserve,fundingCloses:new Date(input.fundingDeadline*1000).toISOString(),maturity:new Date(input.maturity*1000).toISOString(),payees:metadata.settings.recipients.join(', '),termsHash:metadata.termsHash,policy:metadata.settings.policy}:{vault:transaction.to,...Object.fromEntries(['amount','principal','income','recipient','intent','executor','allowed'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]))};
 const record={transaction,approval,metadata,review};await db(env).prepare('INSERT INTO capital_intents(id,owner_id,project,action,payload,created_at) VALUES(?,?,?,?,?,?)').bind(id,principal,project,action,stringify(record),Date.now()).run();
 return {id,project,action,network,transaction,approval,metadata,review,warning:'Review the exact terms, chain, recipient and amount in your wallet. No server signer is used.'};
}
export async function confirm(env,input,principal){
 await chain(env);if(!/^0x[a-fA-F0-9]{64}$/.test(input.transactionHash||''))throw failure(400,'Transaction hash required');
 const intent=await db(env).prepare('SELECT * FROM capital_intents WHERE id=? AND owner_id=?').bind(input.id,principal).first();if(!intent)throw failure(404,'Transaction intent not found');
 const existing=await db(env).prepare('SELECT * FROM capital_receipts WHERE intent_id=?').bind(intent.id).first();
 if(existing){const canonical=await rpc(env,'eth_getBlockByNumber',[hex(existing.block_number),false]);if(canonical?.hash!==existing.block_hash)throw failure(409,'Recorded transaction was reorganized; reconciliation required');if(existing.tx_hash!==input.transactionHash.toLowerCase())throw failure(409,'Intent already confirmed with another transaction');return {status:'confirmed',receipt:existing};}
 const receipt=await rpc(env,'eth_getTransactionReceipt',[input.transactionHash]);if(!receipt)return {status:'pending'};
 if(receipt.transactionHash?.toLowerCase()!==input.transactionHash.toLowerCase())throw failure(409,'Receipt hash mismatch');
 if(receipt.status!=='0x1')throw failure(409,'Transaction reverted');
 const latest=BigInt(await rpc(env,'eth_blockNumber',[]));if(latest-BigInt(receipt.blockNumber)+1n<BigInt(network.confirmations))return {status:'confirming',confirmations:Number(latest-BigInt(receipt.blockNumber)+1n)};
 const block=await rpc(env,'eth_getBlockByNumber',[receipt.blockNumber,false]);if(block?.hash!==receipt.blockHash)throw failure(409,'Chain reorganization; recheck receipt');
 const actual=await rpc(env,'eth_getTransactionByHash',[input.transactionHash]),expected=JSON.parse(intent.payload);
 if(!actual||address(actual.from)!==address(expected.transaction.from)||(actual.to?.toLowerCase()||null)!==(expected.transaction.to?.toLowerCase()||null)||actual.input.toLowerCase()!==expected.transaction.data.toLowerCase()||BigInt(actual.value)!==0n)throw failure(409,'Transaction does not match the prepared action');
 const transactionHash=input.transactionHash.toLowerCase(),stmts=[];
 if(intent.action==='deploy'){
  const contract=address(receipt.contractAddress),code=await rpc(env,'eth_getCode',[contract,receipt.blockNumber]);
  if(!matchesRuntime(code,expected.metadata.settings.policy))throw failure(409,'Unexpected lending contract implementation');
  if(address(await call(env,contract,'controller',[],receipt.blockNumber))!==wallet(principal)||await call(env,contract,'termsHash',[],receipt.blockNumber)!==expected.metadata.termsHash)throw failure(409,'Deployment authority or terms mismatch');
  stmts.push(db(env).prepare('INSERT INTO capital_rounds(project,vault,terms_version,settings,deploy_tx,created_at) VALUES(?,?,?,?,?,?)').bind(intent.project,contract,expected.metadata.termsVersion,stringify(expected.metadata.settings),transactionHash,Date.now()));
 }
 const record={chain_id:network.chainId,tx_hash:transactionHash,intent_id:intent.id,project:intent.project,action:intent.action,block_number:Number(BigInt(receipt.blockNumber)),block_hash:receipt.blockHash};
 stmts.push(db(env).prepare('INSERT INTO capital_receipts(chain_id,tx_hash,intent_id,project,action,block_number,block_hash) VALUES(?,?,?,?,?,?,?)').bind(...Object.values(record)));
 try{await db(env).batch(stmts);}catch(error){const won=await db(env).prepare('SELECT * FROM capital_receipts WHERE intent_id=?').bind(intent.id).first();if(won?.tx_hash===transactionHash)return {status:'confirmed',receipt:won};throw failure(409,'Transaction was already attributed or journal conflict');}
 return {status:'confirmed',receipt:record,contract:receipt.contractAddress||expected.transaction.to};
}
export function matchesRuntime(code,policy='fixed-round-net-income-v1'){
 const artifact=deploymentArtifact(policy);
 if(typeof code!=='string'||code.length!==artifact.runtime.length)return false;
 let actual=code.toLowerCase(),expected=artifact.runtime.toLowerCase();
 for(const refs of Object.values(artifact.immutableReferences||{}))for(const {start,length} of refs){const begin=2+start*2,end=begin+length*2;actual=actual.slice(0,begin)+'0'.repeat(length*2)+actual.slice(end);expected=expected.slice(0,begin)+'0'.repeat(length*2)+expected.slice(end);}
 return actual===expected;
}

export async function readIntent(env,id,principal){
 if(!principal)throw failure(401,'Verified session required');
 const row=await db(env).prepare('SELECT * FROM capital_intents WHERE id=? AND owner_id=?').bind(id,principal).first();if(!row)throw failure(404,'Transaction intent not found');
 return {id:row.id,project:row.project,action:row.action,network,...JSON.parse(row.payload)};
}

export async function registerTerms(env,input,principal){
 if(!principal||typeof input.project!=='string'||typeof input.version!=='string'||!input.terms||typeof input.terms!=='object'||Array.isArray(input.terms))throw failure(400,'Registered terms required');
 const prior=await db(env).prepare('SELECT * FROM public_funding_terms WHERE project=? AND version=?').bind(input.project,input.version).first();const encoded=JSON.stringify(input.terms);
 if(prior){if(prior.owner_id!==principal||prior.terms!==encoded)throw failure(409,'Terms version is immutable');return {status:'registered'};}
 await db(env).prepare('INSERT INTO public_funding_terms(project,version,terms,owner_id) VALUES(?,?,?,?)').bind(input.project,input.version,encoded,principal).run();return {status:'registered'};
}

// Public availability; owner positions are attached only for a verified ingress principal.
export function fundingAvailability(phase, deadline, principal, cap, now) {
 const accepting=String(phase)==='0' && BigInt(deadline)>BigInt(now) && BigInt(principal)<BigInt(cap);
 return {status:accepting?'accepting':'not-accepting',depositEnabled:accepting};
}
// Amounts remain integer USDC base units; never sum money with floating point.
export function poolSummary(rounds) {
 const keys=['pooled','cash','idleAssets','budgetCash','outstanding','debt','distributed'];
 const known=rounds.filter(r=>r.balances);
 const sums=Object.fromEntries(keys.map(k=>[k,known.reduce((sum,r)=>sum+BigInt(r.balances[k]||'0'),0n).toString()]));
 return {status:known.length===rounds.length?'complete':'partial',verifiedRounds:known.length,totalRounds:rounds.length,
  totals:known.length===rounds.length?sums:null,verifiedSubtotal:sums};
}
export async function fundingDirectory(env,principal=null) {
 const rows=(await db(env).prepare('SELECT project,vault,settings FROM capital_rounds ORDER BY created_at DESC').all()).results;
 const items={},all=[];let block=null,lender=null;
 if(principal){try{lender=wallet(principal);}catch{}}
 if(rows.length){try{await chain(env);const latest=BigInt(await rpc(env,'eth_blockNumber',[]));block=hex(latest>=11n?latest-11n:0n);}catch{}}
 for(const row of rows){
  let availability;
  try {
   if(!block)throw Error('Chain unavailable');
   const fields=['phase','fundingDeadline','principal','fundingCap','claimedPrincipal','debt','distributed'];
   const values=await Promise.all(fields.map(name=>call(env,row.vault,name,[],block)));
   const b=Object.fromEntries(fields.map((name,i)=>[name,String(values[i])]));
   b.cash=String(await call(env,network.asset,'balanceOf',[row.vault],block,erc20));
   b.idleAssets=String(await call(env,network.aToken,'balanceOf',[row.vault],block,erc20));
   b.budgetCash='0';
   if(JSON.parse(row.settings).policy===YIELD_POLICY){
    b.botWallet=String(await call(env,row.vault,'budget',[],block,yieldABI));
    b.budgetCash=String(await call(env,network.asset,'balanceOf',[b.botWallet],block,erc20));
   }
   b.pooled=String(BigInt(b.cash)+BigInt(b.idleAssets)+BigInt(b.budgetCash));
   b.outstanding=String(BigInt(b.principal)-BigInt(b.claimedPrincipal));
   if(lender)b.position=String(await call(env,row.vault,'positions',[lender],block));
   availability={...fundingAvailability(b.phase,b.fundingDeadline,b.principal,b.fundingCap,Math.floor(Date.now()/1000)),asOfBlock:block,balances:b};
  } catch {availability={status:'unknown',depositEnabled:false};}
  const r={vault:row.vault,policy:JSON.parse(row.settings).policy,...availability};all.push(r);
  const rounds=[...(items[row.project]?.rounds||[]),r];
  const status=rounds.some(r=>r.status==='accepting')?'accepting':rounds.some(r=>r.status==='unknown')?'unknown':'not-accepting';
  const complete=rounds.every(r=>r.balances);
  const position=lender&&complete?rounds.reduce((n,r)=>n+BigInt(r.balances.position),0n).toString():null;
  items[row.project]={status,depositEnabled:status==='accepting',rounds,pool:poolSummary(rounds),position,
   lending:position!==null?BigInt(position)>0n:null,
   funded:complete?rounds.some(r=>BigInt(r.balances.outstanding)>0n):null};
 }
 return {items,pool:poolSummary(all),personalized:!!lender,asOfBlock:block,checkedAt:new Date().toISOString()};
}
