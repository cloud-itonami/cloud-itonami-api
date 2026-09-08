// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../contracts/BusinessVault.sol';
interface Vm {function warp(uint256) external;function prank(address) external;function startPrank(address) external;function stopPrank() external;function expectRevert() external;}
contract Token is IERC20 {
 mapping(address=>uint256) public balanceOf;mapping(address=>mapping(address=>uint256)) public allowance;
 function mint(address a,uint256 n) external{balanceOf[a]+=n;}
 function burn(address a,uint256 n) external{balanceOf[a]-=n;}
 function transfer(address a,uint256 n) external returns(bool){balanceOf[msg.sender]-=n;balanceOf[a]+=n;return true;}
 function approve(address a,uint256 n) external returns(bool){allowance[msg.sender][a]=n;return true;}
 function transferFrom(address a,address b,uint256 n) external returns(bool){allowance[a][msg.sender]-=n;balanceOf[a]-=n;balanceOf[b]+=n;return true;}
}
contract AToken is Token {address public UNDERLYING_ASSET_ADDRESS;address public POOL;constructor(address asset,address pool){UNDERLYING_ASSET_ADDRESS=asset;POOL=pool;}}
contract Pool is IPool {
 Token public asset;AToken public receipt;bool public frozen;
 constructor(Token t){asset=t;receipt=new AToken(address(t),address(this));}
 function supply(address,uint256 n,address to,uint16) external{asset.transferFrom(msg.sender,address(this),n);receipt.mint(to,n);}
 function withdraw(address,uint256 n,address to) external returns(uint256){require(!frozen,'illiquid');if(n==type(uint256).max)n=receipt.balanceOf(msg.sender);receipt.burn(msg.sender,n);asset.transfer(to,n);return n;}
 function yieldTo(address to,uint256 n) external{asset.mint(address(this),n);receipt.mint(to,n);}
 function freeze(bool b) external{frozen=b;}
}
contract BusinessVaultTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 Token t;Pool p;BusinessVault v;address alice=address(10);address bob=address(11);address bot=address(12);address vendor=address(13);
 bytes32 terms=keccak256('registered terms');
 function setUp() public {vm.warp(1000);t=new Token();p=new Pool(t);address[] memory recipients=new address[](1);recipients[0]=vendor;
 v=new BusinessVault(address(t),address(p.receipt()),address(p),keccak256('org/repo'),terms,2000,100000,100e6,1000e6,10e6,recipients);
 for(uint i;i<2;i++){address a=i==0?alice:bob;t.mint(a,1000e6);vm.prank(a);t.approve(address(v),type(uint256).max);}
 v.setExecutor(bot,true);
 }
 function deposit(address a,uint256 n) internal {vm.prank(a);v.deposit(n,terms);}
 function operate() internal {vm.warp(2000);v.start();}
 function testFullBusinessDeFiRepaymentAndDistribution() public {
 deposit(alice,300e6);deposit(bob,100e6);operate();v.allocate(200e6);p.yieldTo(address(v),20e6);
 vm.prank(bot);v.spend(keccak256('invoice-1'),vendor,100e6);require(t.balanceOf(vendor)==100e6);require(v.debt()==100e6);
 t.mint(vendor,10e6);vm.startPrank(vendor);t.approve(address(v),110e6);v.repay(100e6,10e6);vm.stopPrank();
 v.recall(type(uint256).max);vm.warp(100000);v.settle();vm.prank(alice);v.claim();vm.prank(bob);v.claim();
 require(v.distributed()==430e6);require(t.balanceOf(alice)==1022500000);require(t.balanceOf(bob)==1007500000);require(t.balanceOf(address(v))==0);
 }
 function testRejectsWrongTermsAndLateDeposits() public {vm.prank(alice);vm.expectRevert();v.deposit(10e6,bytes32(0));vm.warp(2000);vm.prank(alice);vm.expectRevert();v.deposit(10e6,terms);}
 function testWithdrawBeforeBusinessAndNoDoubleClaim() public {deposit(alice,100e6);vm.prank(alice);v.withdraw(10e6);require(v.principal()==90e6);operate();vm.prank(alice);vm.expectRevert();v.withdraw(1);vm.warp(100000);v.settle();vm.prank(alice);v.claim();vm.prank(alice);vm.expectRevert();v.claim();}
 function testGrantsCapsReserveAndIntentReplay() public {
 deposit(alice,200e6);operate();vm.prank(bob);vm.expectRevert();v.spend(bytes32(uint256(1)),vendor,1);
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(1)),bob,1);
 vm.prank(bot);v.spend(bytes32(uint256(1)),vendor,90e6);
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(1)),vendor,1);
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(2)),vendor,11e6);
 v.setExecutor(bot,false);vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(2)),vendor,1);
 vm.expectRevert();v.allocate(101e6);
 }
 function testDefaultGraceAndProRataLoss() public {deposit(alice,100e6);operate();vm.prank(bot);v.spend(bytes32(uint256(1)),vendor,90e6);vm.warp(100000);vm.expectRevert();v.settle();vm.warp(100000+7 days);v.settle();require(v.writtenOff()==90e6);vm.prank(alice);v.claim();require(t.balanceOf(alice)==910e6);}
 function testSettlementRecallsAccruedInterestAtomically() public {deposit(alice,100e6);operate();v.allocate(90e6);p.yieldTo(address(v),1e6);vm.warp(100000);v.settle();require(v.settlementAssets()==101e6);require(v.aToken().balanceOf(address(v))==0);}
 function testIlliquidityCannotBeReportedAsDistribution() public {deposit(alice,100e6);operate();v.allocate(90e6);p.freeze(true);vm.warp(100000);vm.expectRevert();v.recall(type(uint256).max);vm.expectRevert();v.settle();require(uint(v.phase())==1);p.freeze(false);v.recall(type(uint256).max);v.settle();}
 function testNoCrossProjectSpend() public {deposit(alice,100e6);operate();vm.prank(address(123));vm.expectRevert();v.setExecutor(address(123),true);vm.prank(address(123));vm.expectRevert();v.allocate(1);}
 function testFuzzProRataConservation(uint64 a,uint64 b,uint64 income) public {
 uint256 x=uint256(a)%400e6+1;uint256 y=uint256(b)%400e6+1;uint256 z=uint256(income)%100e6;
 deposit(alice,x);deposit(bob,y);operate();t.mint(address(v),z);vm.warp(100000);v.settle();vm.prank(alice);v.claim();vm.prank(bob);v.claim();require(v.distributed()==x+y+z);require(t.balanceOf(address(v))==0);
 }
}
