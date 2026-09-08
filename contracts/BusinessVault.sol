// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
interface IERC20 {
 function balanceOf(address) external view returns(uint256);
 function transfer(address,uint256) external returns(bool);
 function transferFrom(address,address,uint256) external returns(bool);
 function approve(address,uint256) external returns(bool);
}
interface IAToken is IERC20 {
 function UNDERLYING_ASSET_ADDRESS() external view returns(address);
 function POOL() external view returns(address);
}
interface IPool {
 function supply(address,uint256,address,uint16) external;
 function withdraw(address,uint256,address) external returns(uint256);
}
/// @notice One fixed-term, non-transferable lender position per business round.
/// No upgrade, arbitrary call, leverage, operator withdrawal or fee surface.
contract BusinessVault {
 IERC20 public immutable asset;
 IAToken public immutable aToken;
 IPool public immutable pool;
 address public immutable controller;
 bytes32 public immutable projectHash;
 bytes32 public immutable termsHash;
 uint256 public immutable fundingDeadline;
 uint256 public immutable maturity;
 uint256 public immutable dailyLimit;
 uint256 public immutable fundingCap;
 uint256 public immutable cashReserve;
 enum Phase { Funding, Operating, Settled }
 Phase public phase;
 uint256 public principal;
 uint256 public debt;
 uint256 public repaid;
 uint256 public businessIncome;
 uint256 public writtenOff;
 uint256 public settlementAssets;
 uint256 public claimedPrincipal;
 uint256 public distributed;
 uint256 private entered;
 mapping(address=>uint256) public positions;
 mapping(address=>bool) public executor;
 mapping(address=>bool) public recipient;
 mapping(bytes32=>bool) public spentIntent;
 mapping(uint256=>uint256) public dailySpent;
 event Deposited(address indexed lender,uint256 amount,bytes32 indexed termsHash);
 event Withdrawn(address indexed lender,uint256 amount);
 event Started();
 event Spent(bytes32 indexed intent,address indexed executor,address indexed recipient,uint256 amount);
 event Repaid(address indexed payer,uint256 principal,uint256 income);
 event Allocated(uint256 amount);
 event Recalled(uint256 amount);
 event Settled(uint256 assets,uint256 loss);
 event Claimed(address indexed lender,uint256 principal,uint256 assets);
 event ExecutorSet(address indexed account,bool allowed);
 modifier lock(){require(entered==0,"reentry");entered=1;_;entered=0;}
 modifier owner(){require(msg.sender==controller,"controller");_;}
 modifier operating(){require(phase==Phase.Operating,"phase");_;}
 constructor(address usdc,address aToken_,address pool_,bytes32 project,bytes32 terms,
  uint256 fundingEnd,uint256 maturity_,uint256 daily,uint256 cap,uint256 reserve,address[] memory payees){
  require(usdc.code.length>0&&aToken_.code.length>0&&pool_.code.length>0,"contracts");
  require(IAToken(aToken_).UNDERLYING_ASSET_ADDRESS()==usdc&&IAToken(aToken_).POOL()==pool_,"reserve");
  require(project!=0&&terms!=0&&fundingEnd>block.timestamp&&maturity_>fundingEnd&&maturity_<=block.timestamp+366 days,"terms");
  require(daily>0&&cap>0&&cap<=1e18&&reserve<=cap&&payees.length>0&&payees.length<=32,"limits");
  asset=IERC20(usdc);aToken=IAToken(aToken_);pool=IPool(pool_);controller=msg.sender;
  projectHash=project;termsHash=terms;fundingDeadline=fundingEnd;maturity=maturity_;dailyLimit=daily;fundingCap=cap;cashReserve=reserve;
  for(uint i;i<payees.length;i++){require(payees[i]!=address(0)&&payees[i]!=address(this),"payee");recipient[payees[i]]=true;}
 }
 function deposit(uint256 amount,bytes32 acceptedTerms) external lock {
  require(phase==Phase.Funding&&block.timestamp<fundingDeadline,"funding closed");
  require(acceptedTerms==termsHash&&amount>0&&principal+amount<=fundingCap,"deposit");
  _take(amount);principal+=amount;positions[msg.sender]+=amount;emit Deposited(msg.sender,amount,termsHash);
 }
 function withdraw(uint256 amount) external lock {
  require(phase==Phase.Funding&&amount>0&&positions[msg.sender]>=amount,"withdraw");
  positions[msg.sender]-=amount;principal-=amount;_send(msg.sender,amount);emit Withdrawn(msg.sender,amount);
 }
 function start() external owner {
  require(phase==Phase.Funding&&block.timestamp>=fundingDeadline&&block.timestamp<maturity&&principal>0,"start");phase=Phase.Operating;emit Started();
 }
 function setExecutor(address account,bool allowed) external owner {require(account!=address(0),"executor");executor[account]=allowed;emit ExecutorSet(account,allowed);}
 function spend(bytes32 intent,address payee,uint256 amount) external lock operating {
  require(executor[msg.sender]&&recipient[payee]&&!spentIntent[intent]&&intent!=0,"grant");
  require(block.timestamp<maturity&&amount>0&&debt+amount<=principal,"credit");
  uint256 day=block.timestamp/1 days;require(dailySpent[day]+amount<=dailyLimit,"daily limit");
  require(asset.balanceOf(address(this))>=amount+cashReserve,"cash reserve");
  spentIntent[intent]=true;dailySpent[day]+=amount;debt+=amount;
  _send(payee,amount);emit Spent(intent,msg.sender,payee,amount);
 }
 function repay(uint256 principalAmount,uint256 income) external lock operating {
  require(principalAmount<=debt&&principalAmount+income>0,"repayment");
  _take(principalAmount+income);debt-=principalAmount;repaid+=principalAmount;businessIncome+=income;emit Repaid(msg.sender,principalAmount,income);
 }
 function allocate(uint256 amount) external lock operating {
  require((msg.sender==controller||executor[msg.sender])&&block.timestamp<maturity,"authority");
  require(amount>0&&asset.balanceOf(address(this))>=amount+cashReserve,"cash reserve");
  require(asset.approve(address(pool),0)&&asset.approve(address(pool),amount),"approval");
  pool.supply(address(asset),amount,address(this),0);require(asset.approve(address(pool),0),"approval reset");emit Allocated(amount);
 }
 /// Anyone can restore liquidity; funds only return to this vault.
 function recall(uint256 amount) external lock operating {
  require(amount>0,"amount");uint256 received=pool.withdraw(address(asset),amount,address(this));emit Recalled(received);
 }
 /// After maturity, the stated seven-day grace expires before default recognition.
 /// Aave liquidity must be recalled first. No caller may send it elsewhere.
 function settle() external lock {
  require(phase!=Phase.Settled&&block.timestamp>=maturity,"maturity");
  if(aToken.balanceOf(address(this))>0) pool.withdraw(address(asset),type(uint256).max,address(this));
  require(aToken.balanceOf(address(this))==0,"recall strategy first");
  require(debt==0||block.timestamp>=maturity+7 days,"repayment grace");
  writtenOff=debt;debt=0;settlementAssets=asset.balanceOf(address(this));phase=Phase.Settled;
  emit Settled(settlementAssets,writtenOff);
 }
 function claim() external lock {
  require(phase==Phase.Settled,"settlement");uint256 units=positions[msg.sender];require(units>0,"position");
  uint256 amount=claimedPrincipal+units==principal?settlementAssets-distributed:settlementAssets*units/principal;
  positions[msg.sender]=0;claimedPrincipal+=units;distributed+=amount;
  _send(msg.sender,amount);emit Claimed(msg.sender,units,amount);
 }
 function _take(uint256 amount) private {
  uint256 before_=asset.balanceOf(address(this));require(asset.transferFrom(msg.sender,address(this),amount),"transfer in");
  require(asset.balanceOf(address(this))==before_+amount,"exact asset");
 }
 function _send(address to,uint256 amount) private {require(asset.transfer(to,amount),"transfer out");}
}
