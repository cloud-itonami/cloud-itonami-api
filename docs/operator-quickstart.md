# Operator quickstart

Bring an unfamiliar checkout to the point where you can prove, locally and
read-only, that this repository's contracts, Worker bundle, journal schema and
live Base grant are the ones this repository claims. Every step below was
executed against `83d5a4a` on 2026-09-09; each records what it printed so a
different result is legible as a difference rather than as noise.

Nothing here signs, broadcasts, deploys or moves money. No step reads a private
key, and no step writes to the production D1 journal or the deployed Worker.
Production deployment and every capital movement remain explicit wallet actions
by the organization or the lender, as `README.md` and `SECURITY.md` state.

## 0. Toolchain

    node --version      # v26.7.0 observed; the repo targets modern Node --test
    forge --version     # 1.7.1
    anvil --version     # 1.7.1

`forge` and `anvil` come from Foundry and are **not** installed by `npm ci`.
On this workstation they exist at `~/.foundry/bin` but are absent from a
non-login shell's `PATH`, which is the single most likely reason a first run
looks broken:

    export PATH="$HOME/.foundry/bin:$PATH"

Without them, `npm test` stops at `forge test` and never reaches the Node
suite. Running the Node suite directly then reports 16 passed / 2 failed, and
both failures read `Error: spawn anvil ENOENT` — a missing binary, not a
defect in `capital.js` or `BotPaymentModule`. Confirm which one you have before
concluding anything about the code:

    command -v forge anvil || echo 'Foundry missing from PATH'

## 1. Dependencies

    npm ci --ignore-scripts

Observed: 45 packages, no build scripts run. `--ignore-scripts` is deliberate —
this tree installs an EVM/Cloudflare dependency set and does not need package
lifecycle scripts to produce any artifact it ships.

`npm audit` reports three high-severity advisories. Confirm reachability
rather than counting them:

    npm ls --all --omit=dev

Observed: the production tree is `ethers@6.17.0` and its subtree, and nothing
else. The three advisories are `wrangler` and, beneath it, `miniflare` and
`sharp` — the local development server and its image dependency. None of them
is uploaded to the Worker, which runs on workerd. An advisory that moves into
the `--omit=dev` tree is a different matter and does reach production.

## 2. Contracts build, and why `git status` is then dirty

    npm run build       # forge build && node scripts/artifact.mjs

`forge build` emits `block-timestamp` lint warnings on `BusinessVault.sol` and
`YieldVault.sol`. They are expected: those comparisons are maturity and grace
deadlines, where a validator's few seconds of timestamp influence is immaterial
against a seven-day grace period.

`scripts/artifact.mjs` then rewrites `src/vault-artifact.json`,
`src/yield-vault-artifact.json` and `src/launcher-artifact.json` from `out/`.
**Two of the three come back modified, and that is expected.** Do not
"fix" it by committing the churn, and do not treat it as a reproducibility
failure without checking which field moved:

    git diff --stat        # src/vault-artifact.json, src/yield-vault-artifact.json

What actually differs is only the *keys* of `immutableReferences` — solc AST
node ids, which shift when the compiler parses a different number of source
units. On this run they moved `78,81,84,…` to `959,962,965,…` in the vault
artifact. The `start`/`length` offsets under those keys were identical, and
`abi`, `bytecode` and `runtime` reproduced byte-for-byte in all three artifacts.

That distinction is load-bearing. `matchesRuntime` in `src/capital.js` — the
function that decides whether an on-chain address holds this repository's
implementation — reads `runtime` and the offset *values*, never the keys. Verify
that, rather than the file hash:

    node -e '
    const fs=require("fs"),cp=require("child_process");
    const flat=o=>JSON.stringify(Object.values(o||{}).flat().map(r=>[r.start,r.length]).sort((a,b)=>a[0]-b[0]));
    for(const f of ["src/vault-artifact.json","src/yield-vault-artifact.json","src/launcher-artifact.json"]){
      const a=JSON.parse(fs.readFileSync(f,"utf8"));
      const b=JSON.parse(cp.execSync("git show HEAD:"+f).toString());
      const same=k=>JSON.stringify(a[k])===JSON.stringify(b[k]);
      console.log(f,"runtime",same("runtime"),"bytecode",same("bytecode"),"abi",same("abi"),
                  "offsets",flat(a.immutableReferences)===flat(b.immutableReferences));
    }'

All four columns must print `true`. If `runtime`, `bytecode` or `abi` prints
`false`, your compiler is producing different code from the committed artifacts
and the on-chain implementation check would reject contracts this tree deploys —
stop and reconcile `solc_version`, `optimizer_runs` and `via_ir` in
`foundry.toml` before going further. Discard the `immutableReferences` churn
with `git checkout -- src` once the columns are green.

## 3. Tests

    npm test            # forge test && node --test test/*.test.mjs

Observed: 23 Solidity tests across `BusinessVault`, `YieldVault`,
`BotFundingLauncher` and `BotPaymentModule`, then 18 Node tests, 0 failed,
exit 0. The Node suite launches isolated Anvil instances on fixed ports
(18547, 18549) and exercises API-prepared, signed EVM transactions and
SQLite-backed receipt recording; a stale process holding those ports fails the
suite for a reason unrelated to the code under test.

These are local tests. They are not live-money tests and not an independent
contract audit, and passing them supports no claim about deployed funds.

## 4. Worker bundle

    npm run check       # wrangler deploy --dry-run

Observed: 417.88 KiB upload, 77.43 KiB gzipped, and exactly four bindings —
`CAPITAL_DB` (D1) plus `BASE_RPC`, `BASE_RPC_FALLBACK` and `BASE_RPC_SECONDARY`.
No Cloudflare authentication is required for the dry run, and none is requested.

Read the binding list, not just the exit code. This Worker's authority model
depends on what it *cannot* reach: no KV, no queue, no secret, no binding to
private conversations or plugin credentials, and no signing key of any kind. A
new binding appearing here is a change to the trust boundary and belongs in
review, not in a deploy.

`wrangler.jsonc` sets `workers_dev: false` and `preview_urls: false`. That is
the enforcement of `SECURITY.md`: the only verified principal reaches this
Worker through the Pages ingress service binding `CAPITAL_API`, which supplies
`x-itonami-principal` after rechecking its own session and same-origin POST.
Never publish this Worker on a public route.

## 5. Journal schema, rehearsed locally

    npx wrangler d1 execute CAPITAL_DB --local --file schema.sql
    npx wrangler d1 execute CAPITAL_DB --local \
      --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

`--local` runs against a throwaway SQLite database under `.wrangler/`, which is
git-ignored. Observed tables: `capital_intents`, `capital_launchers`,
`capital_receipts`, `capital_rounds`, `public_funding_terms`.

Rehearsing locally is the whole point of this step. `schema.sql` is written with
`CREATE TABLE IF NOT EXISTS`, so applying it to the wrong remote database
succeeds silently and leaves a second journal that looks healthy. Confirm the
five tables here first; apply to the dedicated production capital D1 only when
you have separately confirmed the target `database_id`.

## 6. Live grant preflight, read-only

    node scripts/operator-launch-preflight.mjs

This is the only step that touches Base mainnet. It refuses any RPC method
outside a read-only allowlist (`eth_chainId`, `eth_getBlockByNumber`,
`eth_getCode`, `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_getBalance`),
so it cannot broadcast even if asked to.

It fails closed before simulating. Driving the exported `preflight` with an
altered chain id and an altered configuration produced `Wrong chain`,
`Grant authority mismatch` and `Project mismatch` — each refusal naming its own
cause rather than a generic failure. The same guard rejects a missing block, a
runtime that does not match `bot-funding-launcher-v1`, a revoked grant, and a
funding deadline already passed; a grant that has already created its round
aborts with `Round already created`, telling you to confirm the existing round
instead of launching a second. On the command line these exit non-zero.

Observed on 2026-09-09, at Base block `0x30b696f`:

    "status": "prepared-not-signed"
    "project": "cloud-itonami/cloud-itonami-isic-7320"
    "termsHash": "0x5a0bade5…3a2d4802"
    "simulation": "passed"
    "candidateVault": "0x619726cC3a77F58d38527119cBc091646cE7A127"
    "candidateVaultIsDepositAddress": false
    "gasFundingRequired": false
    "signerConnected": false
    "depositEnabled": false

Block number, gas estimate, observed gas price and executor balance are live
chain state and will differ on every run; re-run rather than comparing against
the numbers above. The fields that must not drift are the terms hash, the
project, and the three trailing booleans.

Read `candidateVaultIsDepositAddress: false` literally. `candidateVault` is the
address `launch()` *would* create; it does not exist yet, and neither it nor the
launcher address is a deposit address. Only a verified child YieldVault accepts
deposits, and only after registration and confirmation. `signerConnected: false`
and `depositEnabled: false` are the standing state: no hosted signer is
attached, and `estimatedExecutionGas` excludes the Base L1 data fee, so treat
`executionFeeEstimateETH` as a floor.

## What this quickstart deliberately omits

Production `wrangler deploy`, remote D1 application, the Pages ingress binding,
GitHub admin-grant registration, and every signing or broadcasting action. Those
require an authenticated operator and a wallet, and none of them can be
rehearsed safely from a fresh checkout. `README.md` describes the API surface
and the round lifecycle; `docs/bot-funding-launcher.md` describes the launch
delegation authority; `docs/bot-payment-authority.md` describes the finite
`BotPaymentModule` and its activation requirements; `SECURITY.md` states the
reporting path and the risks that no test in section 3 addresses.

## How this document was verified

Every command above was executed in order on 2026-09-09 against `83d5a4a`, from
a tree reset to `git checkout -- src` with `out/`, `cache/`, `.wrangler/` and
`node_modules/` removed. Sections 1 through 6 each exited 0, and the artifact
snippet in section 2 was additionally shown to discriminate: corrupting one
character of `runtime` printed `runtime false` alone, and shifting one
`immutableReferences` offset by one byte printed `offsets false` alone.

Re-run it the same way when the toolchain, the compiler version or the pilot
grant changes. A step that no longer reproduces is a finding about this
repository, not a defect in the checklist.
