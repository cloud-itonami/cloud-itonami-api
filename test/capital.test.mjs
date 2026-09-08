import {safeDeployment,safeEnvelope,safeABI,safeExecutionSucceeded} from '../src/safe.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {JsonRpcProvider,ContractFactory,Contract,zeroPadValue,keccak256,toUtf8Bytes} from 'ethers';
import {network,units,matchesRuntime,plan,confirm,snapshot,fundingDirectory,safeAccount} from '../src/capital.js';
import artifact from '../src/vault-artifact.json' with {type:'json'};
test('amounts use exact USDC integers; malformed and altered code fail',()=>{assert.equal(units('1.000001'),1000001n);for(const s of ['0','-1','1e6','1.0000001','NaN','1.'])assert.throws(()=>units(s));assert.equal(matchesRuntime(artifact.runtime),true);assert.equal(matchesRuntime('0x00'+artifact.runtime.slice(4)),false);});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE public_funding_terms(project TEXT,version TEXT,terms TEXT,owner_id TEXT)');sqlite.exec(fs.readFileSync('schema.sql','utf8'));
 const db={sqlite,prepare(sql){return {all:async()=>({results:sqlite.prepare(sql).all()}),bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}};},async batch(stmts){sqlite.exec('BEGIN');try{for(const s of stmts)await s.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return db;}
test('actual EVM deployment, signed deposits, bounded Bot spending, DeFi, repayment and distribution are journaled once',async()=>{
 const process=spawn('anvil',['--port','18547','--chain-id','8453','--silent'],{stdio:'ignore'});const provider=new JsonRpcProvider('http://127.0.0.1:18547',8453,{staticNetwork:true,cacheTimeout:-1});provider.pollingInterval=50;
 const originalFetch=globalThis.fetch;let env;
 try{
  for(let i=0;i<100;i++){try{await provider.getBlockNumber();break;}catch{await new Promise(r=>setTimeout(r,50));}}
  const owner=await provider.getSigner(0),lender=await provider.getSigner(1),vendor=await provider.getSigner(2);
  const deploy=async(file,name,args=[])=>{const a=JSON.parse(fs.readFileSync('out/'+file+'/'+name+'.json'));const c=await new ContractFactory(a.abi,a.bytecode.object,owner).deploy(...args);await c.waitForDeployment();return c;};
  const token=await deploy('BusinessVault.t.sol','Token'),pool=await deploy('BusinessVault.t.sol','Pool',[await token.getAddress()]);
  network.asset=await token.getAddress();network.pool=await pool.getAddress();network.aToken=await pool.receipt();
  globalThis.fetch=(url,options)=>originalFetch(url==='https://test-base.invalid'?'http://127.0.0.1:18547':url,options);
  env={BASE_RPC:'https://test-base.invalid',CAPITAL_DB:database()};const org='org/business',principal='did:pkh:eip155:8453:'+owner.address.toLowerCase(),lenderPrincipal='did:pkh:eip155:8453:'+lender.address.toLowerCase();
  env.CAPITAL_DB.sqlite.prepare('INSERT INTO public_funding_terms VALUES(?,?,?,?)').run(org,'v1',JSON.stringify({chainId:8453,idleStrategy:'aave-v3',dailyLimitUSDC:'100'}),principal);
  const now=(await provider.getBlock('latest')).timestamp;
  const input={project:org,action:'deploy',termsVersion:'v1',policy:'fixed-round-net-income-v1',fundingDeadline:now+600,maturity:now+1200,fundingCap:'1000',cashReserve:'10',recipients:[vendor.address]};
  await assert.rejects(plan(env,input,lenderPrincipal),e=>e.status===403);
  const prepared=await plan(env,input,principal);
  const submit=async(p,signer,who)=>{if(p.approval)await (await signer.sendTransaction(p.approval)).wait();const tx=await signer.sendTransaction(p.transaction);await tx.wait();const pending=await confirm(env,{id:p.id,transactionHash:tx.hash},who);assert.equal(pending.status,'confirming');await provider.send('anvil_mine',[12]);return [await confirm(env,{id:p.id,transactionHash:tx.hash},who),tx.hash];};
  const [deployed]=await submit(prepared,owner,principal),vault=deployed.contract;
  const action=async(action,data={},signer=owner,who=principal)=>submit(await plan(env,{project:org,vault,action,...data},who),signer,who);
  await (await token.mint(lender.address,400000000)).wait();
  const [receipt,tx]=await action('deposit',{amount:'400'},lender,lenderPrincipal);
  const duplicate=await confirm(env,{id:receipt.receipt.intent_id,transactionHash:tx},lenderPrincipal);assert.equal(duplicate.status,'confirmed');
  await assert.rejects(confirm(env,{id:receipt.receipt.intent_id,transactionHash:tx},principal),e=>e.status===404);
  // The directory reads one confirmed block and never exposes another wallet's position.
  const portfolio=await fundingDirectory(env,lenderPrincipal);
  assert.equal(portfolio.items[org].position,'400000000');assert.equal(portfolio.items[org].lending,true);
  assert.equal(portfolio.pool.totals.pooled,'400000000');
  const publicView=await fundingDirectory(env);assert.equal(publicView.items[org].position,null);
  assert.equal(publicView.items[org].rounds[0].balances.position,undefined);
  assert.equal((await fundingDirectory(env,principal)).items[org].lending,false);
  await provider.send('evm_setNextBlockTimestamp',[now+601]);await provider.send('anvil_mine',[1]);await action('start');await action('setExecutor',{executor:owner.address,allowed:true});
  await action('allocate',{amount:'200'});await (await pool.yieldTo(vault,20000000)).wait();
  await action('spend',{intent:keccak256(toUtf8Bytes('invoice-1')),recipient:vendor.address,amount:'100'});
  await (await token.mint(owner.address,110000000)).wait();await action('repay',{principal:'100',income:'10'});
  await action('recall',{amount:'220'});await provider.send('evm_setNextBlockTimestamp',[now+1201]);await provider.send('anvil_mine',[1]);await action('settle');await action('claim',{},lender,lenderPrincipal);
  const state=await snapshot(env,org,vault,lenderPrincipal);assert.equal(state.balances.distributed,'430000000');assert.equal(state.balances.cash,'0');assert.equal(state.balances.position,'0');assert.equal(await token.balanceOf(lender.address),430000000n);
  assert.equal(env.CAPITAL_DB.sqlite.prepare('SELECT count(*) AS n FROM capital_receipts').get().n,10);
  env.CAPITAL_DB.sqlite.prepare('INSERT INTO public_funding_terms VALUES(?,?,?,?)').run(org,'yield-v1',JSON.stringify({chainId:8453,idleStrategy:'aave-v3',dailyLimitUSDC:'100',fundingPolicy:'yield-budget-v1',botShareBps:5000}),principal);
  const yinput={...input,termsVersion:'yield-v1',policy:'yield-budget-v1',fundingDeadline:now+2400,maturity:now+3600};
  await assert.rejects(plan(env,{...yinput,policy:'fixed-round-net-income-v1'},principal),e=>e.status===400);
  const [yd]=await submit(await plan(env,yinput,principal),owner,principal),yv=yd.contract;
  const ya=async(action,data={},signer=owner,who=principal)=>submit(await plan(env,{project:org,vault:yv,action,...data},who),signer,who);
  await ya('deposit',{amount:'100'},lender,lenderPrincipal);
  await provider.send('evm_setNextBlockTimestamp',[now+2401]);await provider.send('anvil_mine',[1]);await ya('start');await ya('setExecutor',{executor:owner.address,allowed:true});
  await assert.rejects(ya('spend',{intent:keccak256(toUtf8Bytes('yield-spend')),recipient:vendor.address,amount:'1'}),e=>e.status===409);
  await ya('allocate',{amount:'90'});await (await pool.yieldTo(yv,10000000)).wait();await ya('harvest');
  await ya('spend',{intent:keccak256(toUtf8Bytes('yield-spend')),recipient:vendor.address,amount:'5'});
  let ys=await snapshot(env,org,yv,lenderPrincipal);assert.equal(ys.balances.debt,'0');assert.equal(ys.balances.cash,'105000000');assert.equal(ys.balances.budgetCash,'0');assert.equal(ys.rounds.length,2);
  await provider.send('evm_setNextBlockTimestamp',[now+3601]);await provider.send('anvil_mine',[1]);await ya('settle');await ya('claim',{},lender,lenderPrincipal);
  ys=await snapshot(env,org,yv,lenderPrincipal);assert.equal(ys.balances.distributed,'105000000');
  const closed=await fundingDirectory(env,lenderPrincipal);assert.equal(closed.items[org].lending,false);
  assert.equal(closed.pool.totals.outstanding,'0');assert.equal(closed.pool.totals.pooled,'0');


  // Real, hash-pinned Safe runtime on the local EVM. No mainnet signing or funds.
  const fixture=JSON.parse(fs.readFileSync('test/fixtures/safe-1.4.1.json'));
  const safe='0x0000000000000000000000000000000000009999';
  await provider.send('anvil_setCode',[safe,fixture.proxy]);
  await provider.send('anvil_setCode',[safeDeployment.singleton,fixture.singleton]);
  await provider.send('anvil_setStorageAt',[safe,zeroPadValue('0x00',32),zeroPadValue(safeDeployment.singleton,32)]);
  const safeContract=new Contract(safe,['function setup(address[],uint256,address,bytes,address,address,uint256,address)'],owner);
  const zero='0x0000000000000000000000000000000000000000';
  await (await safeContract.setup([owner.address],1,zero,'0x',zero,zero,0,zero)).wait();
  assert.equal((await safeAccount(env,safe,principal)).autonomousExecution,false);
  await assert.rejects(safeAccount(env,safe,lenderPrincipal),e=>e.status===403);
  const [sr]=await submit(await plan(env,{...input,fundingDeadline:now+4200,maturity:now+4800},principal),owner,principal);
  const sv=sr.contract;
  await (await token.mint(safe,10000000)).wait();
  const sp=await plan(env,{project:org,vault:sv,action:'deposit',amount:'10',safe},principal);
  assert.equal(sp.transaction.to,safe);assert.equal(sp.transaction.from,owner.address.toLowerCase());
  const [sd]=await submit(sp,owner,principal);
  assert.equal(sd.contract,sv);assert.equal((await snapshot(env,org,sv,principal,safe)).balances.position,'10000000');
  assert.equal((await fundingDirectory(env,principal,safe)).items[org].lending,true);
  assert.equal((await fundingDirectory(env,principal)).items[org].lending,false);
  await submit(await plan(env,{project:org,vault:sv,action:'withdraw',amount:'10',safe},principal),owner,principal);
  assert.equal(await token.balanceOf(safe),10000000n);
  assert.equal((await fundingDirectory(env,principal,safe)).items[org].lending,false);

 }finally{globalThis.fetch=originalFetch;provider.destroy();process.kill();}
});

test('Safe envelope permits CALL only and verifies its inner execution event',()=>{
 const safe='0x'+'1'.repeat(40),owner='0x'+'2'.repeat(40),to='0x'+'3'.repeat(40);
 const t=safeEnvelope(safe,owner,{to,data:'0x12345678',value:'0x0'});
 const d=safeABI.decodeFunctionData('execTransaction',t.data);assert.equal(d[3],0n);assert.equal(d[6],0n);assert.equal(d[9].slice(-2),'01');
 assert.throws(()=>safeEnvelope(safe,owner,{to,data:'0x',value:'0x1'}));
 const event=n=>({address:safe,...safeABI.encodeEventLog(safeABI.getEvent(n),['0x'+'0'.repeat(64),0])});
 assert.equal(safeExecutionSucceeded({logs:[event('ExecutionSuccess')]},safe),true);
 assert.equal(safeExecutionSucceeded({logs:[event('ExecutionFailure')]},safe),false);
 assert.equal(safeExecutionSucceeded({logs:[]},safe),false);
});

test('pinned Safe runtime matches the official deployment record',()=>{
 const official=JSON.parse(fs.readFileSync('node_modules/@safe-global/safe-deployments/src/assets/v1.4.1/safe_l2.json'));
 assert.equal(official.deployments.canonical.codeHash,safeDeployment.singletonCodeHash);
 assert.equal(official.networkAddresses['8453'],'canonical');
 const fixture=JSON.parse(fs.readFileSync('test/fixtures/safe-1.4.1.json'));
 assert.equal(keccak256(fixture.singleton),safeDeployment.singletonCodeHash);assert.equal(keccak256(fixture.proxy),safeDeployment.proxyCodeHash);
});
