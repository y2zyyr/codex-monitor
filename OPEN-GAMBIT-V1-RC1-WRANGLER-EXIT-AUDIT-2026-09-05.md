# RC1 Wrangler exit audit — 2026-09-05

Decision: EXIT_GATE_PASS. All required commands now return naturally with exit code 0. Application source, migrations, staging, and production were unchanged.

## Root cause

Classification: ENVIRONMENT_SPECIFIC. An unresponsive npm-registry connection in this environment exposes a concrete lifecycle defect in Wrangler 4.125.0's bundled update-check 1.5.4. This is not a demonstrated version regression: no earlier working-version boundary was established.

The update checker calls Node HTTPS `get` with a timeout, then attaches `.on("error", reject).on("timeout", reject)`. Rejecting a promise does not close its HTTP request. When the registry stalls, the rejected request retains a referenced TLS socket, keeping Wrangler alive after its real work finishes. Wrangler's outer Promise.race timeout also does not cancel that request. The previous suggestion that this might be a Node-version or Vitest issue was not supported by the isolated evidence.

## Toolchain versions

- macOS 26.3.1, build 25D2128; arm64.
- Default Node 26.4.0; npm 11.17.0.
- Bundled alternative Node 24.19.0.
- Wrangler 4.125.0; bundled Miniflare 5.20260820.0-alpha; Vitest 2.1.9.
- package-lock.json already resolved Wrangler 4.125.0 before this audit. Its package history did not identify an earlier known-working version. No dependency was upgraded or downgraded.
- All three launchers resolve to the same local package: `node_modules/wrangler/bin/wrangler.js`; `.bin/wrangler` is its symlink. That wrapper spawns `wrangler-dist/cli.js` with inherited standard streams and an IPC channel.
- No repository Node engine constraint was present. Changing Node alone did not cure the pre-fix hang.

## Process / open-handle evidence

A temporary, read-only async_hooks preload recorded active handles after completion, without printing request headers, credentials, or payloads. Example process tree: launcher PID 39732 (parent 35288), Wrangler PID 39745 (parent 39732), plus esbuild service children 39746/39747. Both launcher and Wrangler were sleeping, not performing build work.

After the completion banner, the main Wrangler thread reported only `TCPSocketWrap` as its active resource and a `TLSSocket` handle. `lsof -nP` showed an established connection from 198.18.0.1 to 198.18.0.52:443. These are the local network's mapped addresses; they do not establish the real registry host by themselves.

The allocation stack independently identified the request: Node HTTPS get → Wrangler bundle line 40889 → update-check loadPackage → getMostRecent → fetchLatestNpmVersion → printWranglerBanner. The esbuild worker thread's MessagePorts were also observed, but were not the main-thread referenced resource preventing exit. Correcting request cancellation allowed the entire launcher/CLI/esbuild process tree to finish naturally.

## Minimal reproduction and build isolation

A disposable directory contained a Worker exporting only a fetch function returning a short Response, a minimal Wrangler config, and one local migration creating a single table. There were no application imports, Workflow, R2, assets, provider clients, schedulers, or source maps. Its build printed completion yet remained running before the fix. Thus Open Gambit module initialization is not required to reproduce the issue.

Precise reproduction notes: use unpatched Wrangler 4.125.0; make the registry consulted by update-check accept an HTTPS request but stop responding; run a minimal build. The banner's best-effort update check times out, the build finishes, and the request remains referenced. Inspect active resources before terminating the diagnostic process. This also explains intermittency when the registry responds or the update-check cache is fresh. No upstream issue was published.

The permanent regression test runs the actual patched bundled timeout callback against a local HTTP server that accepts but never answers a request. It requires the socket to close and the child to exit naturally. The test's five-second failure bound never turns a timeout into success.

## Invocation matrix

| Invocation | Before fix | After fix |
| --- | --- | --- |
| npx / npm exec / direct local binary --version | All print 4.125.0 and exit 0 | Same package retained |
| Direct staging-config build | Completion printed; referenced TLS socket remained | Exit 0, 11.238 s isolated; 11.949 s final gate |
| Minimal build, direct binary | Completion printed; process remained | Exit 0 (also via Node 24) |
| Minimal build, npx --no-install | Prior RC1 npm/npx build hung; same resolved binary | Exit 0, 6.184 s |
| Minimal build, npm exec --no | Same resolved binary; separate pre-fix build not measured | Exit 0, 6.116 s |
| Minimal local D1 migrations, direct | Migration applied; observed outstanding update-check socket; eventually exited as network state changed | Exit 0, 10.330 s |
| Minimal build, Node 24.19.0 | Prior RC1 staging dry run also hung | Exit 0, 6.023 s |

whoami was unnecessary: this diagnosis and fix require no Cloudflare account operation. All audit reproduction writes were local.

## D1 / migration and Vitest harness behavior

verify-migration-parity.mjs uses execFileSync(process.execPath, [the local Wrangler wrapper, ...args]), without a shell. Standard input is ignored/closed; stdout and stderr are captured pipes. It passes CI=1 and a 120-second failure timeout. There is no custom AbortController or retained application timer. The Vitest test has its own 180-second timeout.

Manual local migration reproduction and the independent build hang place the defect below Vitest. The parent correctly waits for the live child to exit; ignoring that wait would hide the defect. Neither parity script nor its SQL assertions nor its timeouts were changed. Following request cleanup, the existing full-suite parity test passed in 51.568 seconds. The separate migration:parity gate also passed all 21 migrations, 18 Gambit tables, 17 indexes, zero FK violations, six triggers, and all nine rejected mutation attacks.

## Environment, Node, and Wrangler findings

Prior RC1 experiments with proxy variables removed, metrics disabled, and Node 24 did not resolve the hang. CI=1 was already active in the failing parity child. This audit confirmed that metrics-disabled builds still allocate the update-check TLS socket; telemetry and update checking are distinct. The inspected update-check path has no supported disable switch used here. The same locked Wrangler package works correctly on both Node versions after the lifecycle fix, so no Node downgrade is justified.

Version bisection was not necessary: the exact offending request and missing cleanup were identified in the installed source and verified experimentally. The report does not claim that a newer Wrangler release fixes the issue.

## Fix and why it is not a workaround

scripts/patch-wrangler-update-check.mjs applies a version-guarded, exact-content-guarded patch to the three bundled update-check copies. The timeout handler now destroys its own request with a descriptive Error; the existing error handler rejects normally. Successful responses and all CLI operation/error handling are unchanged. No command status is forged, no process is force-exited, and no completion text is used as a success signal.

package.json now pins the already-resolved Wrangler 4.125.0 and invokes this idempotent patch through postinstall. The lockfile changes only the root version declaration and install-script metadata; resolved dependency versions/integrities are unchanged. Unknown versions or unexpected bundle contents fail loudly and require reassessment. Installation with lifecycle scripts disabled requires explicitly running npm run postinstall before validation; the new regression test detects an unapplied patch.

This is maintained local dependency surgery, not a claim that upstream has shipped a fix. On a future Wrangler upgrade, verify upstream request cancellation and remove or reassess this guard. No application architecture or migration harness was altered.

## Exact verification results

Fresh shell commands, normal exit code 0 throughout; wall times include natural request cleanup:

| Command | Wall time | Result |
| --- | --- | --- |
| npm run typecheck | 3.177 s | PASS |
| npm run lint | 3.360 s | PASS |
| npm test | 54.319 s | PASS: 28 files; 322 passed, 1 skipped |
| npm run build | 7.698 s | PASS |
| npm run migration:parity | 95.760 s | PASS |
| npm run open-gambit:demo | 1.519 s | PASS: 2 tests |
| ./node_modules/.bin/wrangler build --config wrangler.staging.jsonc | 11.949 s | PASS |
| git diff --check | under 1 s | PASS |

Post-fix commands required no manual termination and left no unexpected audit Wrangler/workerd children. Pre-fix diagnostic processes were inspected before being terminated; those diagnostic terminations are not part of the final success path. Temporary diagnostic source/config/preload files and their local database/build directory were removed. Historical untracked reports were preserved; release cleanliness refers to tracked release content.

## Staging impact and production readiness

This changes only local toolchain maintenance and tests. Worker source, UI, model routing, public identities, scheduling, schemas, and migrations are unchanged. Staging remains at RC1 4af025d81d19b6494f748a4887b95b5782766ad8. No redeployment or paid Workflow was needed. Previous staging UI and Workflow/R2/LLM evidence remains valid. The local exit gate is cleared; production still requires its separately authorized release procedure. No production operation was performed in this audit.

ROOT_CAUSE_CLASSIFICATION: ENVIRONMENT_SPECIFIC
ROOT_CAUSE_IDENTIFIED: YES
WRANGLER_COMMAND_EXITS_NORMALLY: YES
MIGRATION_PARITY_PROCESS_EXITS_NORMALLY: YES
NO_MANUAL_KILL_REQUIRED: YES
NO_FAKE_TIMEOUT_SUCCESS: YES
TYPECHECK: PASS
LINT: PASS
TESTS: PASS
BUILD: PASS
MIGRATION_PARITY: PASS
LOCAL_DEMO: PASS
RELEASE_WORKTREE_CLEAN: YES
STAGING_REDEPLOY_REQUIRED: NO
STAGING_REVERIFIED_IF_REQUIRED: NOT_REQUIRED
PRODUCTION_MUTATED: NO
PRODUCTION_DEPLOYED: NO
SAFE_FOR_PRODUCTION_RELEASE: YES
FINAL DECISION: EXIT_GATE_PASS
