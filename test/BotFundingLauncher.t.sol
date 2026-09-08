// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../contracts/BotFundingLauncher.sol';
import './BusinessVault.t.sol';
contract BotFundingLauncherTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 Token token;Pool pool;BotFundingLauncher launcher;
 address bot=address(12);address vendor=address(13);address lender=address(14);
 function setUp() public {
  vm.warp(1000);token=new Token();pool=new Pool(token);address[] memory payees=new address[](1);payees[0]=vendor;
  launcher=new BotFundingLauncher(bot,BotFundingLauncher.Terms(address(token),address(pool.receipt()),address(pool),keccak256('org/repo'),keccak256('approved terms'),2000,100000,1e6,10e6,0,5000),payees);
 }
 function launch() internal returns(YieldVault v){vm.prank(bot);v=YieldVault(launcher.launch());}
 function deposit(YieldVault v) internal {token.mint(lender,10e6);vm.startPrank(lender);token.approve(address(v),10e6);v.deposit(10e6,keccak256('approved terms'));vm.stopPrank();}
 function testBotCreatesRoundAndSpendsYieldWithoutOwnerPerAction() public {
  YieldVault v=launch();require(v.controller()==address(launcher) && v.executor(bot));deposit(v);
  vm.warp(2000);vm.prank(bot);launcher.start();vm.prank(bot);v.allocate(10e6);pool.yieldTo(address(v),2e6);
  vm.prank(bot);v.harvest();vm.prank(bot);v.spend(keccak256('invoice'),vendor,1e6);
  require(token.balanceOf(vendor)==1e6 && v.principal()==10e6 && token.balanceOf(address(v))==11e6);
  vm.warp(100000);v.settle();vm.prank(lender);v.claim();require(token.balanceOf(lender)==11e6);
 }
 function testOneApprovedRoundOnlyAndNoUnapprovedCaller() public {
  vm.expectRevert();launcher.launch();launch();vm.prank(bot);vm.expectRevert();launcher.launch();
 }
 function testRevocationBeforeLaunchAndAfterLaunch() public {
  launcher.revoke();vm.prank(bot);vm.expectRevert();launcher.launch();
 }
 function testRevocationDoesNotTrapLenderFunds() public {
  YieldVault v=launch();deposit(v);launcher.revoke();require(!v.executor(bot));
  vm.warp(2000);vm.prank(bot);vm.expectRevert();launcher.start();
  vm.prank(lender);v.withdraw(10e6);require(token.balanceOf(lender)==10e6);
 }
 function testExpiredGrantCannotLaunch() public {vm.warp(2000);vm.prank(bot);vm.expectRevert();launcher.launch();}
}
