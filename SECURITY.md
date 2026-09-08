# Security

Report privately through GitHub vulnerability reporting. Do not include keys or
real account data in public reports. Apply the workspace Web3-first human session
policy. Service routing does not authenticate a person. Wallet login does not
authorize a transaction or grant Bot execution. The ingress must reverify its
session and same-origin POST before supplying x-itonami-principal over a private
service binding. This Worker must not have a public route.

The contract and its immutable terms are the spending authority. No API/operator
key can withdraw, change recipients, upgrade a vault or replace a lender. Only
the controller can grant/revoke executor addresses; grants remain bounded by the
immutable payees, cash reserve, maturity and daily limit. Shared Bot workspaces
must never contain signing keys. Verify actual receipt sender, calldata, value,
chain, status, canonical block and deployment code before accepting any ledger
entry. A prepared intent, tx hash or public listing alone proves nothing.

Risks include borrower default, registered conditions conflicting with code,
issuer freezes, Aave loss/illiquidity, controller or executor compromise, RPC
misbehavior and reorganizations. Tests are not an audit. Limit initial exposure
and do not enable an unverified deployment or a different strategy/chain by
changing a client input. No Veda/Morpho/Monad adapter is claimed in this release.
