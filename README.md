# cloud-itonami-api

The service-binding-only financial API for Itonami public `org/repo` businesses.
It owns the USDC lending contract, transaction preparation, exact receipt
verification and the shared capital journal. It does not store a signing key.

- `cloud-itonami-app/shared/bots-ui`: shared capital views and wallet review.
- `cloud-itonami-apex`: public app routing; it does not authorize spending.
- `network-awai/cloud-itonami`: existing session ingress and thin service proxy.
- `cloud-itonami-cli`: read, prepare and confirm client, without a wallet key.
- `kotoba-lang/treasury`: existing payment quote/receipt domain library; it is
  not a lending vault or EVM execution engine and is not duplicated as one here.

## Implemented round

Base native USDC, Aave V3, one fixed-term contract per business round. The
organization first registers its conditions and proves current repository admin
access using a post-login GitHub grant. The same verified wallet prepares a
contract deployment. Its signed deployment binds the public project, registered
terms version, full immutable round settings and controller. Only a matching
successful deployment of this exact compiled implementation enters the directory.

Lenders deposit against the exact terms hash. They can withdraw while funding
has not started. The controller may start only after the fundraising deadline.
Explicitly granted executor addresses can pay only the immutable approved
recipients, below the daily limit and outstanding principal ceiling. Each
invoice/task hash is spendable once. Cash reserves are enforced on spend and
Aave allocation. Tokens are never borrowed from Aave; there is no leverage or
arbitrary contract-call route.

Business repayments distinguish principal from income. Aave income accrues in
the actual aToken balance. After maturity, all Aave assets must be recalled and
debt must be repaid, or the fixed seven-day grace must expire before recognizing
unpaid debt as a loss. All recovered assets and net income are distributed pro
rata; the last claim receives rounding dust. No fixed yield is promised. The
round does not accept new deposits after funding closes, preventing stale-NAV
entry dilution. There is no administrator recovery withdrawal or upgrade key.
Late repayment after settlement is rejected; on-chain loss recognition does not
itself discharge a legal repayment obligation. Organizations must register
compatible conditions before accepting deposits.

## API

Public ingress: `https://app.itonami.cloud/api/capital`.

- GET `?project=org/repo[&vault=0x...]`: actual chain state and historical rounds.
- GET `?intent=id`: exact prepared transaction, limited to its authenticated owner.
- POST `action=deploy`: registered terms version, deadlines, cap, cash reserve,
  payees and `policy=fixed-round-net-income-v1`; returns deployment transaction.
- POST actions `deposit`, `withdraw`, `start`, `spend`, `repay`, `allocate`,
  `recall`, `settle`, `claim`, `setExecutor`: project and verified vault required.
- POST `action=confirm`, `id`, `transactionHash`: checks exact sender, calldata,
  destination, zero native value, success, canonical block and 12 L2 confirmations.

Amounts are decimal strings with at most six decimals. Storage/calldata use
integers. Approvals are for the exact amount only. Preparing a transaction is
not executing it. The browser asks the wallet to sign; the CLI emits the
transaction for a signer. Bot tools return review links, not fabricated payments.
An explicitly authorized executor can call `spend` directly under the same
on-chain caps. The hosted Bot worker does not acquire an autonomous signer by
sharing a browser or logging in. There is no implicit service signing authority.

Twelve Base confirmations are an L2 observation threshold, **not L1 finality**.
Idempotent confirmation rechecks canonicality; detected reorganizations stop
confirmation and require journal reconciliation. Balances are read live at one
specified block, not inferred from stored receipts or advertised APR.

## Run and verify

`npm ci --ignore-scripts && npm run build && npm test && npm run check`

Foundry contract tests cover actual transfers, Aave-style supply/withdraw,
repayment, profit/loss distribution, caps, revoked permissions, replay,
illiquidity and 256 randomized pro-rata cases. The Node test launches isolated
Anvil and exercises API-prepared, signed EVM transactions and SQLite-backed
receipt recording end to end. These are local tests, not live-money tests or an
independent audit. Veda, Steakhouse/Morpho and Monad adapters are not enabled.

The existing ingress rechecks repository administrator access and copies only the
selected organization terms into the dedicated capital journal. The capital
Worker has no binding to private conversations or plugin credentials.

Before deploying the Worker, apply `schema.sql` to the dedicated capital D1
journal. Configure the existing Pages ingress service binding `CAPITAL_API`.
The Worker has no public route or workers.dev URL; only that binding supplies
its verified principal. Never expose this worker directly without implementing
the same session/CSRF authority boundary. `BASE_RPC` must be an HTTPS Base RPC.
No private key configuration exists. Production contract deployment and capital
movements are explicit wallet actions by the organization or lender.

## Sources

USDC: https://www.circle.com/blog/usdc-now-available-natively-on-base
Aave addresses: https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol
Aave liquidity: https://www.aave.com/help/supplying/withdraw-tokens

## Maturity

Implemented and locally exercised; no independent contract audit, public borrower
terms, deployed lending round, or live financial settlement is implied by the API
Worker deployment. Do not represent this version as audited or risk-free.
