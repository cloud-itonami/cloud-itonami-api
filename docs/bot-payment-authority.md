# Bot payment authority

`BotPaymentModule` is a finite operating budget attached to one Safe and one
Bot executor address. Deploying the contract does **not** activate it: the Safe
must explicitly call `enableModule(module)` in an owner-authorized transaction.
The hosted Bot runtime does not yet have a production signing-service binding.
Do not report an address, deployed module, or test receipt as live authorization.

## Scope

- One immutable Safe, executor, token, `keccak256(org/repo)`, chain, expiry,
  daily token limit, lifetime token limit, and recipient allowlist.
- The only external operation is token `transfer(recipient, amount)` using
  Safe operation `CALL`, with zero native value. No approval, delegatecall,
  arbitrary call, configuration change, or upgrade method exists.
- Each nonzero invoice/intent hash is usable once. Failed transfers revert
  accounting; UTC day rollover does not reset the lifetime budget.
- The Safe may permanently revoke through `module.revoke()`, or disable its
  module through the standard Safe module management interface. The Bot cannot
  grant, extend, replace, or reactivate its own authority.
- Limits are per module. Multiple modules share the Safe balance but do not
  share counters; review aggregate outstanding grants before enabling another.

This operates only on the Safe's own operating funds. It does not grant access
to BusinessVault or YieldVault principal, does not create lender positions, and
is not a substitute for their registered conditions or executor checks. Borrowed
funds continue to use vault `spend` and its existing accounting. In yield-only
rounds, the principal remains in the vault and may not be moved to this Safe as
an operating budget.

## Activation checklist

1. Create a dedicated executor seed through kagi; retain only its public address
   and exact item reference outside custody. Use `kagi.chain-signer` for governed
   signing. Never place the seed in a Bot workspace, Worker, or environment.
2. Obtain explicit recipients, daily and lifetime USDC limits (6 decimals), and
   expiry from the owner. Missing fields mean inactive; there are no defaults.
3. Verify Base chain 8453, Safe owners/threshold/runtime, and canonical USDC
   `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Deploy the reviewed module with
   those immutable terms, then verify its runtime and all public getters.
4. Have the Safe owner enable that exact verified module. Read the confirmed
   `isModuleEnabled` state; do not mark activation from a submitted hash alone.
5. Bind the specific authenticated Bot/project to the executor in a separately
   governed signing process. The signer must accept only the verified module's
   `pay` calls on Base, with gas limits and durable per-invoice idempotency.
   No caller-supplied digest, signing item, destination, chain or transaction
   method may become ambient authority. Never expose a generic signing endpoint.
6. Confirm an owner-approved small real payment and its token transfer, module
   event, receipt sender, canonical block and finality before claiming live
   automatic payments. Executor gas funding is separate from the USDC budget.

## Verification

`forge test` covers unauthorized calls, recipients, duplicate intents, daily and
lifetime limits, expiry, revocation, disabled modules and transfer rollback.
`node --test test/bot-payment-module.test.mjs` installs the hash-pinned Safe 1.4.1
runtime on local Anvil, activates the module with the owner, pays with the Bot
signer alone, and revokes it. This uses local test assets only; it is not an audit
or proof of a production signer, module deployment, or payment.
