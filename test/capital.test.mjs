import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawn} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {JsonRpcProvider,ContractFactory,Contract,keccak256,toUtf8Bytes} from 'ethers';
import {network,units,matchesRuntime,plan,confirm,snapshot} from '../src/capital.js';
import artifact from '../src/vault-artifact.json' with {type:'json'};
test('amounts use exact USDC integers; malformed and altered code fail',()=>{assert.equal(units('1.000001'),1000001n);for(const s of ['0','-1','1e6','1.0000001','NaN','1.'])assert.throws(()=>units(s));assert.equal(matchesRuntime(artifact.runtime),true);assert.equal(matchesRuntime('0x00'+artifact.runtime.slice(4)),false);});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE public_funding_terms(project TEXT,version TEXT,terms TEXT,owner_id TEXT)');sqlite.exec(fs.readFileSync('schema.sql','utf8'));
 const db={sqlite,prepare(sql){return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}};},async batch(stmts){sqlite.exec('BEGIN');try{for(const s of stmts)await s.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return db;}
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

 }finally{globalThis.fetch=originalFetch;provider.destroy();process.kill();}
});
