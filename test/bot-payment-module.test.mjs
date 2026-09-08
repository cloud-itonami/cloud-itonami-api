import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {Contract,ContractFactory,Interface,JsonRpcProvider,ZeroAddress,zeroPadValue,id} from 'ethers';
import {safeDeployment,safeEnvelope} from '../src/safe.js';

test('real Safe requires activation, then Bot pays without owner signature and owner can revoke',async()=>{
 const child=spawn('anvil',['--port','18549','--chain-id','8453','--silent'],{stdio:'ignore'});
 const provider=new JsonRpcProvider('http://127.0.0.1:18549',8453,{staticNetwork:true,cacheTimeout:-1});provider.pollingInterval=50;
 try {
  for(let i=0;i<100;i++){try{await provider.getBlockNumber();break;}catch{await new Promise(r=>setTimeout(r,50));}}
  const owner=await provider.getSigner(0),bot=await provider.getSigner(1),vendor=await provider.getSigner(2);
  const fixture=JSON.parse(fs.readFileSync('test/fixtures/safe-1.4.1.json'));
  const safe='0x0000000000000000000000000000000000008888';
  await provider.send('anvil_setCode',[safe,fixture.proxy]);await provider.send('anvil_setCode',[safeDeployment.singleton,fixture.singleton]);
  await provider.send('anvil_setStorageAt',[safe,zeroPadValue('0x00',32),zeroPadValue(safeDeployment.singleton,32)]);
  const safeContract=new Contract(safe,['function setup(address[],uint256,address,bytes,address,address,uint256,address)','function enableModule(address)','function isModuleEnabled(address) view returns(bool)'],owner);
  await (await safeContract.setup([owner.address],1,ZeroAddress,'0x',ZeroAddress,ZeroAddress,0,ZeroAddress)).wait();
  const deploy=async(file,name,args=[])=>{const a=JSON.parse(fs.readFileSync(`out/${file}/${name}.json`));const c=await new ContractFactory(a.abi,a.bytecode.object,owner).deploy(...args);await c.waitForDeployment();return c;};
  const token=await deploy('BusinessVault.t.sol','Token');
  const module=await deploy('BotPaymentModule.sol','BotPaymentModule',[safe,bot.address,await token.getAddress(),id('org/repo'),(await provider.getBlock('latest')).timestamp+3600,1000000,2000000,[vendor.address]]);
  const m=await module.getAddress();await (await token.mint(safe,3000000)).wait();
  await assert.rejects(module.connect(bot).pay.staticCall(id('invoice'),vendor.address,1000000));
  const sendOwner=async(to,data)=>{await (await owner.sendTransaction(safeEnvelope(safe,owner.address,{to,value:'0x0',data}))).wait();};
  await sendOwner(safe,safeContract.interface.encodeFunctionData('enableModule',[m]));assert.equal(await safeContract.isModuleEnabled(m),true);
  const receipt=await (await module.connect(bot).pay(id('invoice'),vendor.address,1000000)).wait();
  assert.equal(receipt.from.toLowerCase(),bot.address.toLowerCase());assert.equal(await token.balanceOf(vendor.address),1000000n);
  await assert.rejects(module.connect(bot).pay.staticCall(id('invoice'),vendor.address,1));
  await assert.rejects(module.connect(bot).pay.staticCall(id('another'),vendor.address,1));
  await sendOwner(m,module.interface.encodeFunctionData('revoke',[]));
  assert.equal(await module.revoked(),true);await assert.rejects(module.connect(bot).pay.staticCall(id('after-revoke'),vendor.address,1));
 } finally {provider.destroy();child.kill();}
});
