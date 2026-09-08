// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import './BusinessVault.t.sol';
import '../contracts/YieldVault.sol';
contract YieldVaultTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 Token t;Pool p;YieldVault v;address alice=address(10);address bot=address(12);address vendor=address(13);bytes32 terms=keccak256('yield terms');
 function setUp() public {vm.warp(1000);t=new Token();p=new Pool(t);address[] memory payees=new address[](1);payees[0]=vendor;
 v=new YieldVault(address(t),address(p.receipt()),address(p),keccak256('org/repo'),terms,2000,100000,100e6,1000e6,10e6,payees,5000);
 t.mint(alice,100e6);vm.startPrank(alice);t.approve(address(v),100e6);v.deposit(100e6,terms);vm.stopPrank();v.setExecutor(bot,true);vm.warp(2000);v.start();}
 function testPrincipalCannotBeSpentAndRealizedYieldOnly() public {
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(1)),vendor,1);
 v.allocate(90e6);p.yieldTo(address(v),10e6);
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(1)),vendor,1);
 v.harvest();require(t.balanceOf(address(v.budget()))==5e6);require(v.retainedYield()==5e6);
 v.harvest();require(v.budgetAllocated()==5e6);
 vm.prank(bot);v.spend(bytes32(uint256(1)),vendor,5e6);require(v.debt()==0);require(t.balanceOf(address(v))==105e6);
 vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(2)),vendor,1);
 vm.warp(100000);v.settle();vm.prank(alice);v.claim();require(t.balanceOf(alice)==105e6);
 }
 function testUnusedBudgetReturnsAndDirectAccessFails() public {v.allocate(90e6);p.yieldTo(address(v),10e6);v.harvest();BotYieldBudget b=v.budget();vm.prank(bot);vm.expectRevert();b.pay(bot,1);vm.warp(100000);v.settle();require(v.settlementAssets()==110e6);require(t.balanceOf(address(v.budget()))==0);}
 function testLossAndIlliquidityStopBudget() public {v.allocate(90e6);p.yieldTo(address(v),10e6);p.freeze(true);vm.expectRevert();v.harvest();require(v.budgetAllocated()==0);p.freeze(false);v.harvest();t.burn(address(v),6e6);vm.prank(bot);vm.expectRevert();v.spend(bytes32(uint256(1)),vendor,1);vm.expectRevert();v.harvest();}
 function testFuzzHarvestCannotConsumePrincipal(uint64 raw) public {uint256 profit=uint256(raw)%100e6;v.allocate(90e6);p.yieldTo(address(v),profit);v.harvest();require(t.balanceOf(address(v))>=v.principal());require(v.budgetAllocated()+v.retainedYield()==profit);v.harvest();require(v.harvested()==profit);}
}
