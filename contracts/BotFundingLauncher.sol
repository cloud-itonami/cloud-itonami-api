// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import './YieldVault.sol';

/// @notice One owner-approved yield round, created and started by an operator Bot.
/// The approval cannot mint additional rounds or change terms after funding.
contract BotFundingLauncher {
 struct Terms {
  address asset;address aToken;address pool;bytes32 project;bytes32 termsHash;
  uint256 fundingEnd;uint256 maturity;uint256 dailyLimit;uint256 cap;
  uint256 reserve;uint256 botShareBps;
 }
 address public immutable owner;
 address public immutable bot;
 uint256 public immutable chainId;
 Terms public terms;
 address[] private payees;
 YieldVault public vault;
 bool public revoked;
 event RoundCreated(address indexed vault,bytes32 indexed project,bytes32 termsHash);
 event AuthorityRevoked();
 constructor(address bot_,Terms memory terms_,address[] memory payees_) {
  require(bot_!=address(0) && bot_!=msg.sender,"bot");
  require(terms_.asset.code.length>0 && terms_.aToken.code.length>0 && terms_.pool.code.length>0,"contracts");
  require(IAToken(terms_.aToken).UNDERLYING_ASSET_ADDRESS()==terms_.asset && IAToken(terms_.aToken).POOL()==terms_.pool,"reserve");
  require(terms_.project!=0 && terms_.termsHash!=0,"terms");
  require(terms_.fundingEnd>block.timestamp && terms_.maturity>terms_.fundingEnd && terms_.maturity<=block.timestamp+365 days,"dates");
  require(terms_.dailyLimit>0 && terms_.cap>0 && terms_.cap<=1e18 && terms_.reserve<=terms_.cap,"limits");
  require(terms_.botShareBps>0 && terms_.botShareBps<=10000 && payees_.length>0 && payees_.length<=32,"policy");
  for(uint256 i;i<payees_.length;i++) {
   require(payees_[i]!=address(0),"payee");
   for(uint256 j;j<i;j++)require(payees_[j]!=payees_[i],"duplicate payee");
  }
  owner=msg.sender;bot=bot_;chainId=block.chainid;terms=terms_;payees=payees_;
 }
 modifier operator(){require(msg.sender==bot && !revoked && block.chainid==chainId,"operator");_;}
 function recipients() external view returns(address[] memory){return payees;}
 function launch() external operator returns(address) {
  require(address(vault)==address(0) && block.timestamp<terms.fundingEnd,"launch");
  Terms memory t=terms;
  vault=new YieldVault(t.asset,t.aToken,t.pool,t.project,t.termsHash,t.fundingEnd,t.maturity,t.dailyLimit,t.cap,t.reserve,payees,t.botShareBps);
  vault.setExecutor(bot,true);
  emit RoundCreated(address(vault),t.project,t.termsHash);return address(vault);
 }
 function start() external operator {require(address(vault)!=address(0),"vault");vault.start();}
 /// Permanent: no replacement executor, grant extension or reactivation surface.
 function revoke() external {
  require(msg.sender==owner,"owner");revoked=true;
  if(address(vault)!=address(0))vault.setExecutor(bot,false);
  emit AuthorityRevoked();
 }
 /// If operator was revoked before start, lenders keep their funding withdrawals.
 /// If already operating, public recall/settlement/claim remain available.
}
