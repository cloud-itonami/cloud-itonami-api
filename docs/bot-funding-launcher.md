# Operator Bot launch delegation

BotFundingLauncher separates investor activity from operator activity. An owner
initially deploys a grant containing the exact project, terms hash, Base asset
and strategy, recipients, 10-USDC-style cap, dates, daily limit and Bot share.
The constructor accepts no unbounded authority. The named Bot then calls launch
with **no arguments** and receives one immutable YieldVault. It can start the
round and use that vault's bounded executor operations without further owner
signatures. Investors only approve USDC, deposit, withdraw, or claim.

The API can prepare and confirm the initial grant, prepare the operator launch,
and register its verified child after confirmation. The pilot grant was deployed on Base at
`0x2a2c39d240c10f19a7f2c1971a1ba560d00ab413` in transaction
`0x7ff67c4934dee18a344c2ad51f93da92d356e33bbff4586c8b8e2ee6a20a04cf`
and confirmed in the production journal. A hosted operator signer is not yet connected. Do not expose a
launcher address as a deposit address: only its verified child YieldVault may
accept deposits, after registration and confirmation.

## Authority

- The grant owner is the deployment caller, and the executor is fixed.
- A grant can create exactly one round, before its fixed funding deadline.
- No method changes terms, payees, executor or deployment implementation.
- The owner may permanently revoke before or after launch. Revocation disables
  vault executor permissions and the Bot's start capability. If not started,
  lender withdrawal remains available; after start, recall and settlement remain
  public, preserving the existing withdrawal and maturity rules.
- Multiple separate grants require separate owner authorization; this is not an
  unlimited factory authorization.

## Integration boundary

Before activation, the server must bind the owner-approved registered terms to
this grant, verify the grant and child runtimes and getters at a confirmed block,
and index only its RoundCreated child into the capital registry. Verification
must check project, terms hash, strategy, caps, dates, recipients, share, grant
owner, named executor and controller (which is the grant, not the Bot EOA).
Existing direct-deployment verification must remain unchanged for older rounds.

The governed signing service must authorize the exact grant's launch/start or
the verified child's bounded methods. Routing a user's principal to a generic
signer is not delegation. Keep the key in kagi and do not hand deployment or
payment signing to the investor UI. Production remains unavailable until this
binding and observed end-to-end receipt validation exist.

## Tests

forge test covers operator-only creation, single-round limits, expired/revoked
grants, investor exit after revocation, and the complete Bot-created yield round:
deposit -> Bot start -> Aave allocation -> realized yield -> Bot payment ->
settlement and lender claim. These are local simulated assets, not live funding.

## Pilot preflight

Run `node scripts/operator-launch-preflight.mjs` to read the pilot grant and
prepare its unsigned `launch()` request. It checks chain, runtime, owner,
executor, project, revocation, existing child and deadline at an observed block.
It simulates creation, estimates execution gas, and reads the executor ETH
balance. It never reads a key, signs, broadcasts, or enables deposits.

The 2026-09-08 observation at block `0x30aacb4` passed simulation but found
zero ETH on the executor. The execution gas estimate was 2,349,721; this is not
a fee guarantee and excludes Base L1 data fees. Refresh before any execution.
The candidate child address is not an active deposit destination. Production
requires an independently operated signer and a confirmed, indexed RoundCreated
receipt before enabling investor deposits.
