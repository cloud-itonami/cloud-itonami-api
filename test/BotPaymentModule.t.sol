// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import '../contracts/BotPaymentModule.sol';
import './BusinessVault.t.sol';
contract ModuleSafeMock is IModuleSafe {
 address public module;bool public enabled=true;
 function setModule(address m) external {module=m;}
 function disable() external {enabled=false;}
 function execTransactionFromModuleReturnData(address to,uint256 value,bytes calldata data,uint8 op) external returns(bool,bytes memory) {
  require(msg.sender==module && enabled && value==0 && op==0,"module");return to.call(data);
 }
 function revokeModule() external {BotPaymentModule(module).revoke();}
}
contract BotPaymentModuleTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 Token token;ModuleSafeMock safe;BotPaymentModule module;
 address bot=address(12);address vendor=address(13);
 function setUp() public {
  vm.warp(1000);token=new Token();safe=new ModuleSafeMock();address[] memory recipients=new address[](1);recipients[0]=vendor;
  module=new BotPaymentModule(address(safe),bot,address(token),keccak256('org/repo'),300000,10e6,15e6,recipients);
  safe.setModule(address(module));token.mint(address(safe),100e6);
 }
 function pay(uint256 id,uint256 amount) internal {vm.prank(bot);module.pay(bytes32(id),vendor,amount);}
 function testFiniteBudgetAcrossDays() public {
  pay(1,10e6);require(token.balanceOf(vendor)==10e6);vm.expectRevert();pay(2,1);
  vm.warp(90000);pay(2,5e6);vm.warp(180000);vm.expectRevert();pay(3,1);require(module.totalSpent()==15e6);
 }
 function testAuthorityRecipientAndReplay() public {
  vm.expectRevert();module.pay(bytes32(uint256(1)),vendor,1);
  vm.prank(bot);vm.expectRevert();module.pay(bytes32(uint256(1)),address(14),1);
  pay(1,1);vm.expectRevert();pay(1,1);vm.expectRevert();pay(0,1);
 }
 function testExpiryAndOwnerRevocation() public {
  vm.expectRevert();module.revoke();safe.revokeModule();vm.expectRevert();pay(1,1);
 }
 function testExpiryBoundary() public {vm.warp(300000);vm.expectRevert();pay(1,1);}
 function testSafeDisableAndTransferFailureRollBackBudget() public {
  token.burn(address(safe),100e6);vm.expectRevert();pay(1,1);require(module.totalSpent()==0 && !module.paid(bytes32(uint256(1))));
  token.mint(address(safe),10);safe.disable();vm.expectRevert();pay(1,1);require(module.totalSpent()==0);
 }
}
