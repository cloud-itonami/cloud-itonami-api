// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IModuleSafe {
 function execTransactionFromModuleReturnData(address,uint256,bytes calldata,uint8) external returns(bool,bytes memory);
}

/// @notice A single Bot's finite, revocable operating budget in its owner's Safe.
/// Does not access lending vaults, approve tokens, delegatecall or upgrade itself.
contract BotPaymentModule {
 address public immutable safe;
 address public immutable executor;
 address public immutable asset;
 bytes32 public immutable projectHash;
 uint256 public immutable chainId;
 uint256 public immutable expiresAt;
 uint256 public immutable dailyLimit;
 uint256 public immutable totalLimit;
 uint256 public totalSpent;
 bool public revoked;
 bool private entered;
 mapping(address=>bool) public recipient;
 mapping(uint256=>uint256) public dailySpent;
 mapping(bytes32=>bool) public paid;
 event Paid(bytes32 indexed intent,address indexed recipient,uint256 amount);
 event Revoked();

 constructor(address safe_,address executor_,address asset_,bytes32 project_,uint256 expires_,uint256 daily_,uint256 total_,address[] memory recipients) {
  require(safe_.code.length>0 && asset_.code.length>0,"contracts");
  require(executor_!=address(0) && executor_!=safe_,"executor");
  require(project_!=bytes32(0),"project");
  require(expires_>block.timestamp && expires_<=block.timestamp+366 days,"expiry");
  require(daily_>0 && daily_<=total_ && total_<=1e18,"limits");
  require(recipients.length>0 && recipients.length<=32,"recipients");
  safe=safe_;executor=executor_;asset=asset_;projectHash=project_;
  chainId=block.chainid;expiresAt=expires_;dailyLimit=daily_;totalLimit=total_;
  for(uint256 i;i<recipients.length;i++) {
   address r=recipients[i];require(r!=address(0) && r!=safe_ && r!=address(this) && !recipient[r],"recipient");recipient[r]=true;
  }
 }

 /// @dev Only the Safe's own authorized transaction can revoke; no reactivation.
 function revoke() external {require(msg.sender==safe,"safe");revoked=true;emit Revoked();}

 function pay(bytes32 intent,address to,uint256 amount) external {
  require(!entered,"reentry");entered=true;
  require(msg.sender==executor && block.chainid==chainId,"authority");
  require(!revoked && block.timestamp<expiresAt,"inactive");
  require(intent!=bytes32(0) && !paid[intent],"intent");
  require(recipient[to] && amount>0,"payment");
  uint256 day=block.timestamp/1 days;
  require(amount<=dailyLimit-dailySpent[day] && amount<=totalLimit-totalSpent,"budget");
  paid[intent]=true;dailySpent[day]+=amount;totalSpent+=amount;
  (bool success,bytes memory result)=IModuleSafe(safe).execTransactionFromModuleReturnData(
   asset,0,abi.encodeWithSignature("transfer(address,uint256)",to,amount),0);
  require(success && result.length==32 && abi.decode(result,(bool)),"transfer");
  emit Paid(intent,to,amount);entered=false;
 }
}
