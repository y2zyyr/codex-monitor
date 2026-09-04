# OPEN GAMBIT V1 — PRE-STAGING RELEASE FREEZE

Audit date: 2026-09-04 (verification continued into 2026-09-05 Asia/Shanghai)

Repository: /Users/kyho/Documents/modelyard_dev/codex-monitor

This is a local pre-staging freeze audit. No staging or production deployment,
remote migration, R2 write, Workflow creation, Cron mutation, DNS change,
secret mutation, or GitHub release was performed.

## 1. Executive Decision

Decision: READY_AFTER_OWNER_ACTION

The current implementation is locally auditable and the release-scope hardening
is complete: the Gambit schema is additive, public AI identities are separated
from runtime routing, provenance is retained, public publication remains human
approved, political content is excluded, prediction/history writes are
append-only, request and spend bounds are enforced, and the local verification
gates pass. The worktree is intentionally dirty and contains several earlier
Tibo/Community deliverables, so an owner must select and commit the exact
release scope before staging.

## 2. Dirty Worktree Classification

git status --short contains 28 modified entries and 49 untracked entries after
this report and the release manifest are included. Directory entries are
expanded below where useful. Every modified or untracked status entry is in
exactly one category.

### BASELINE_TIBO

Modified:

    src/classifier/llm.ts
    src/classifier/types.ts
    src/db/repository.ts
    src/utils/timezone.ts
    static/analytics.js
    static/app.js
    static/local-time.js
    static/robots.txt

Untracked:

    migrations/0017_monitor_event_translations.sql
    migrations/0019_query_efficiency.sql
    migrations/0020_classifier_coverage.sql
    scripts/run-p0-shadow.mjs
    src/event-translations.ts

### COMMUNITY

Untracked:

    migrations/0013_community.sql
    migrations/0014_community_enhancements.sql
    migrations/0015_community_admin_posts.sql
    migrations/0016_community_translations.sql
    migrations/0018_community_agent_posts.sql
    src/community/config.ts
    src/community/filters.ts
    src/community/github.ts
    src/community/identity.ts
    src/community/repository.ts
    src/community/security.ts
    src/community/service.ts
    src/community/topics.ts
    src/community/translation.ts
    src/community/types.ts
    src/routes/admin-community.ts
    src/routes/community.ts
    static/community-admin.js
    static/community.js

### OPEN_GAMBIT

Untracked:

    migrations/0021_open_gambit.sql
    scripts/record-provenance.mjs
    scripts/verify-gambit-migration.mjs
    src/open-gambit/budget.ts
    src/open-gambit/canonical.ts
    src/open-gambit/disclosure.ts
    src/open-gambit/evidence.ts
    src/open-gambit/index.ts
    src/open-gambit/llm.ts
    src/open-gambit/pipeline.ts
    src/open-gambit/policy.ts
    src/open-gambit/renderer.ts
    src/open-gambit/repository.ts
    src/open-gambit/resolution.ts
    src/open-gambit/service.ts
    src/open-gambit/snapshots.ts
    src/open-gambit/sources.ts
    src/open-gambit/types.ts
    src/open-gambit/workflow-entrypoint.ts
    src/open-gambit/workflow.ts
    src/provenance.ts
    src/routes/open-gambit.ts
    static/open-gambit-admin.js

### SHARED_REQUIRED

Modified:

    package.json
    src/cron.ts
    src/index.ts
    src/renderer.ts
    src/routes/api.ts
    src/types.ts
    static/style.css

Untracked:

    scripts/verify-migration-parity.mjs
    src/assets.ts
    src/i18n.ts
    static/locale-time.js

### CONFIG_TEMPLATE

Modified:

    .dev.vars.example
    wrangler.example.jsonc

Untracked:

    wrangler.staging.example.jsonc

### DOCUMENTATION

Modified:

    README.md

Untracked:

    OPEN-GAMBIT-CLOUDFLARE-ONLY-AUDIT-2026-09-04.md
    OPEN-GAMBIT-FEASIBILITY-AUDIT-2026-09-04.md
    OPEN-GAMBIT-V1-LOCAL-IMPLEMENTATION-REPORT-2026-09-04.md
    P0-CLASSIFIER-COVERAGE-IMPLEMENTATION-REPORT.md
    P0-DEPLOYMENT-READINESS-REPORT.md
    P0-REAL-LLM-SHADOW-VALIDATION-REPORT.md
    PROJECT-AUDIT-2026-09-04.md
    TIBO-P0-PRODUCTION-ROLLOUT-REPORT.md
    TIBO-P0-PRODUCTION-ROLLOUT-RESUME-REPORT.md
    TIBO_COMMUNITY_AGENT_PUBLISHING_REPORT.md
    docs/open-gambit/ARCHITECTURE.md
    OPEN-GAMBIT-V1-PRE-STAGING-RELEASE-MANIFEST-2026-09-04.md
    OPEN-GAMBIT-PRE-STAGING-FREEZE-2026-09-04.md

The historical audit/rollout documents are documentation artifacts, not
runtime resources. Some contain non-secret production identifiers or readiness
statements from earlier work; the owner must decide whether to retain,
redact, or exclude them from the release commit. No secret value is copied
into this freeze report.

### TEST

Modified:

    tests/classification.test.ts
    tests/cron-source.test.ts
    tests/e2e/production.spec.ts
    tests/e2e/seo.spec.ts
    tests/e2e/states.spec.ts
    tests/keywords.test.ts
    tests/repository.test.ts
    tests/reset-hints.test.ts
    tests/seo-v2-renderer.test.ts
    tests/timezone.test.ts

Untracked:

    tests/community.test.ts
    tests/e2e/community.spec.ts
    tests/event-translations.test.ts
    tests/llm-classifier.test.ts
    tests/migration-parity.test.ts
    tests/open-gambit-demo.test.ts
    tests/open-gambit.test.ts
    tests/p0-shadow.test.ts
    tests/product-scope.test.ts

### GENERATED_LOCAL

Ignored local/generated paths are not release inputs:

    .wrangler/
    dist/
    node_modules/
    test-results/

The ignored wrangler.jsonc is an owner-controlled local configuration file,
not a generated release artifact and not a changed status entry. The parent
.env is outside the repository and is never copied into release artifacts.

### OBSOLETE

None. No current modified or untracked path was classified obsolete; historical
documents remain documentation until the owner chooses their release scope.

### UNKNOWN_REQUIRES_OWNER

None among the current modified/untracked paths. Owner decisions remain
necessary for release selection, historical-document retention, real staging
resource identifiers, and environment secrets; those are external decisions,
not unknown file ownership.

## 3. Unknown / Owner Decisions

The audit did not silently discard any current path. The owner must:

- choose which BASELINE_TIBO, COMMUNITY, SHARED_REQUIRED, OPEN_GAMBIT, test,
  configuration, and documentation paths belong in this release;
- review or exclude historical documents that mention non-secret production
  identifiers or stale readiness conclusions;
- create a clean release commit from the selected paths;
- provision isolated staging Worker, D1, private R2, and Workflow resources;
- supply the named staging secrets and actual non-secret provider/model config;
- run the staging preflight and make the separate production decision.

No commit, branch rewrite, reset, clean, deploy, or remote state change was
performed by this audit.

## 4. Repository Reproducibility

REPRODUCIBLE_FROM_REPOSITORY is YES for the selected release snapshot:
source, migrations, tests, configuration templates, provenance code, and local
verification commands are present in the repository. A clean owner-reviewed
commit is still required because the current HEAD alone does not include the
dirty worktree changes.

The reproducibility boundary is explicit. Cloudflare account/resource IDs,
secrets, live source-registry values, and provider credentials are operator
inputs and are not committed. npm install, npm test, the typecheck/lint
commands, the two example-config builds, the local D1 parity script, and the
fictional local demo are deterministic repository procedures subject to their
declared toolchain versions.

## 5. Migration Audit: 0001 → 0021

The ordered local migration chain is:

    0001_initial.sql
    0002_classification_retry.sql
    0003_data_integrity.sql
    0004_reset_cycles.sql
    0005_provider_usage_budget.sql
    0006_clear_raw_reset_time_text.sql
    0007_backfill_x_post_dates.sql
    0008_expire_stale_reset_cycles.sql
    0009_reconcile_lifecycle_and_provider_status.sql
    0010_fix_indexed_completion_confirmation.sql
    0011_manual_reset_reports.sql
    0012_correct_reset_completion_and_precedence.sql
    0013_community.sql
    0014_community_enhancements.sql
    0015_community_admin_posts.sql
    0016_community_translations.sql
    0017_monitor_event_translations.sql
    0018_community_agent_posts.sql
    0019_query_efficiency.sql
    0020_classifier_coverage.sql
    0021_open_gambit.sql

Fresh local D1 parity passed with high-water mark 0021_open_gambit.sql, 21
migrations applied, 18 Gambit tables, 17 Gambit indexes, and zero foreign-key
violations. The parity verifier also ran nine direct immutability attacks:
all nine prohibited UPDATE/DELETE attempts were rejected, while append-only
resolution and correction writes succeeded.

Migrations 0005 and 0020 contain historical core-table rebuild patterns
that are part of the existing ledger and must be applied in order; they are
not accidental duplicates or candidates for deletion. Migration 0021 is
additive: it creates only gambit_* tables/indexes/triggers, uses
IF NOT EXISTS, and does not alter or drop existing Tibo or Community tables.
The duplicate-name scan found only intentional rebuild/v2 names from the
historical chain, not an accidental duplicate introduced by 0021.

## 6. Secret / Configuration Audit

The parent local environment was inspected by variable name only. It contains
an OPENCODE_GO_API_KEY, but the value was read only in memory by the minimal
live smoke, never printed, copied, logged, committed, or placed in a report.
No credential value is exposed here.

The scoped repository scan found no non-fixture credential-pattern match. The
only bearer-like test fixture is explicitly marked TEST_ONLY. Template files
contain placeholders and empty fields only. The ignored local wrangler.jsonc
remains owner-controlled and was not changed or copied. Historical documents
may contain non-secret production identifiers and require owner review; they
do not authorize a deployment.

Open Gambit has its own secret namespace: GAMBIT_LLM_API_KEY and
GAMBIT_ADMIN_TOKEN. The latter is separate from COMMUNITY_ADMIN_TOKEN.
Existing Tibo/Community credentials remain separate operator inputs. No secret
is sent to browser assets or included in build metadata.

## 7. Live Provider Smoke

The minimal smoke test passed against the currently configured backend. It used
only fictional TEST_ONLY Northstar Labs / BridgeSpec content and a tiny
structured triage response; it did not create a candidate, article, or full
publication.

Safe result summary:

    provider: opencode-go
    authentication_and_endpoint: PASS
    response_received: PASS
    structured_json_parsed: PASS
    timeout_behavior: PASS
    model_identifier: configured internally; not emitted

The smoke also verified bounded structured requests, redacted upstream errors,
and timeout handling. This is the sufficient live-provider check for this
freeze. It does not prove that the three visitor-facing identities are three
callable backend models, and no such proof or credentials are required.

## 8. Actual Multi-LLM and Public Identity State

PUBLIC_AI_IDENTITIES: Claude Fable 5 / GPT-5.6 Sol / DeepSeek V4 Pro

ACTUAL_RUNTIME_MODEL: configurable; currently verified through the live provider smoke test

The implementation now makes the separation explicit in role configuration:
publicAiIdentity is the visitor-facing presentation value;
runtimeProvider and runtimeModelId are independent execution settings. The
runtime settings come from the Gambit namespace (GAMBIT_LLM_PROVIDER,
GAMBIT_LLM_BASE_URL, GAMBIT_LLM_MODEL, and explicit role overrides). A
public identity is never copied into an API model field or used to choose a
provider. Changing the configured backend therefore does not change the
website identities, and changing a website identity does not silently reroute
the backend.

gambit_llm_attempts retains actual adapter-returned provider and model_id,
alongside role, the public identity (display_name), prompt version, request
hash, timestamp, and token/latency usage when known. Visitor pages expose the
disclosure and labels, not the actual provider unless a later product decision
intentionally adds that surface.

The English disclosure says that Tibo presents the three names as AI
identities, that underlying models/providers are configurable and may vary by
availability, quality, cost, and task requirements, and that not every task
invokes every model or identity. The Chinese disclosure carries the same
meaning: 三个 AI 身份 are presentation identities while 底层模型与服务商
may be dynamically configured. It does not assert a fixed 1:1 backend mapping.

## 9. Product Boundary and Presentation

Open Gambit is a secondary, discoverable section inside Tibo: public routes
are linked from the existing navigation, and the homepage module is compact,
non-dominant, and hidden when there is no approved publication. The design has
no full-screen takeover, oversized hero, Gambit score, or AI-themed visual
replacement of the primary Tibo monitor.

Article rendering keeps FACT, ANALYSIS, and AI FORECAST visually and
semantically distinct. Probabilities are rendered as AI estimates, not scores;
source links and canonical/hreflang metadata are present; EN/ZH routes are
supported. Publication requires human approval and the article can say
NO_TRAJECTORY_ISSUED when evidence is insufficient.

## 10. Political Exclusion

Political signals are checked deterministically during qualification and again
before public reads. Patterns cover politicians, parties/elections,
geopolitics/war, ideology/culture-war framing, legislative conflict, and
government-only strategy. Regulatory or filing context can remain when a
technology/company subject is primary; a government-only item is held out.

Candidates marked political are rejected or held for review, and public
landing/article queries filter them even if a bad row exists. Tests cover
English/Chinese signals, technology-context qualification, and the second
public-read boundary. No political topic is eligible for silent relabeling as
technology analysis.

## 11. Prediction Immutability Attack

The fresh local D1 attack exercised nine prohibited operations:

- changing original probability, statement, deadline, reasoning, or status;
- deleting or updating a resolution event;
- deleting or updating a correction.

All nine were rejected by the six SQLite triggers covering predictions,
resolution events, and corrections. A second resolution event and correction
were then appended successfully. Repository write paths use insert/append or
idempotent conflict handling; there is no public update/delete path for an
original forecast. Stale approvals require explicit acknowledgement and
idempotency keys prevent duplicate review effects.

## 12. Failure-Mode Handling

| Failure mode | Local handling | Freeze result |
| --- | --- | --- |
| LLM unavailable | Triage/analysis returns NEEDS_HUMAN_REVIEW; critic may use bounded deterministic fallback | PASS |
| Malformed structured output | Bounded retries, invalid_structured_json, no direct publication | PASS |
| Source timeout, redirect, private host, oversize body | Source failure is recorded; bounded body/response limits apply; no unsafe follow-on fetch | PASS |
| R2 unavailable or write failure | Discovery fails closed or skips the source; no candidate is persisted from an R2 write failure | PASS |
| Workflow retry | One bounded exponential retry with five-minute step timeout | PASS by code/test; remote execution not attempted |
| Duplicate Workflow result | Deterministic workflow ID and persisted result hash return DUPLICATE_WORKFLOW_RESULT | PASS |
| Duplicate cron/run window | Run-window uniqueness returns DUPLICATE_RUN_WINDOW/skip | PASS |
| Duplicate candidate | Content fingerprint and INSERT OR IGNORE preserve one candidate | PASS |
| D1 transient/error | Error propagates to the Workflow/retry boundary; no remote failure was induced | PASS by boundary design; remote not tested |
| Budget exhaustion | Separate gambit_* budgets fail closed and record a bounded skip | PASS |
| Stale approval | Returns conflict unless explicit stale acknowledgement is supplied | PASS |
| Translation failure | English publication remains canonical; derived translation is marked FAILED and falls back safely | PASS |
| Resolution ambiguity | Appends UNRESOLVED/human-review state rather than guessing | PASS |
| Oversized admin/request JSON | Stream is bounded and returns 413 PAYLOAD_TOO_LARGE without parsing unbounded input | PASS |

Remote Cloudflare adapters, production resources, and browser-driven staging
execution remain operator-owned preconditions rather than claims of live
verification.

## 13. Complete Verification Results

Final local verification completed at 2026-09-04T16:16:35Z UTC. The focused
Gambit run passed 27 Open Gambit tests plus 2 demo tests (29 total). The full
suite passed 27 test files and 320 tests, with 1 intentionally skipped (321
tests including the skip).

Final command results:

    npm test: PASS — 27 files; 320 passed, 1 skipped
    npm run typecheck: PASS
    npm run lint: PASS
    npm run build: PASS — local Wrangler dry-run
    npm run migration:parity: PASS — 21 migrations; 18 tables; 17 indexes; 0 FK violations; 9/9 attacks rejected
    npm run open-gambit:demo: PASS — 2 tests
    npx wrangler build --config wrangler.example.jsonc: PASS — dry-run
    npx wrangler build --config wrangler.staging.example.jsonc: PASS — dry-run
    git diff --check: PASS

Builds are local Wrangler dry-run builds. The migration parity command uses a
fresh temporary local D1 and removes its temporary state. No command in this
audit invokes the deploy script or a remote migration.

## 14. Release Manifest

The companion manifest is
OPEN-GAMBIT-V1-PRE-STAGING-RELEASE-MANIFEST-2026-09-04.md. It records HEAD,
expected clean-commit state, migration/schema/prompt/disclosure versions,
commands, non-secret bindings, required secret names, and expected
staging/production resources without storing values.

## 15. Staging Preconditions

Before staging, the owner must select and commit the release scope, copy and
complete wrangler.staging.example.jsonc, provision an isolated Worker/D1/
private R2/Workflow set, and provide GAMBIT_LLM_API_KEY,
GAMBIT_ADMIN_TOKEN, plus the existing Tibo/Community secrets required by
the chosen scope. GAMBIT_SCHEDULE_ENABLED must remain false for the first
preflight. Apply migrations and deploy only through an explicitly approved
staging operation, then verify health/provenance, no public political content,
human-review gating, private R2 behavior, and browser routes.

No staging resource was contacted or mutated by this freeze.

## 16. Production Preconditions

Production requires separate sign-off after staging evidence. The owner must
verify the existing migration ledger through 0020, apply 0021_open_gambit.sql
through the maintained production procedure, provision/configure the private
Gambit R2 and Workflow resources, set the separate secrets, review provenance
and rollback behavior, and keep dedicated Gambit schedules disabled until the
rollout decision. Existing Tibo monitoring must be checked independently.

No production resource was queried or mutated by this freeze. This report does
not authorize production migration, deployment, Cron changes, R2 writes, DNS,
or release publication.

## 17. Exact Next Recommended Action

Owner reviews the classification and historical documents, stages a clean
release commit containing the selected paths, then provisions isolated staging
resources for a no-schedule preflight; do not deploy from the current dirty
worktree.

REPRODUCIBLE_FROM_REPOSITORY: YES
DIRTY_WORKTREE_UNDERSTOOD: YES
UNKNOWN_USER_WORK_REMAINING: YES
FRESH_LOCAL_MIGRATION_CHAIN: PASS
MIGRATION_0021_ADDITIVE: YES
SECRET_SCAN: PASS
OPENCODE_KEY_LEAKED: NO
LIVE_PROVIDER_SMOKE: PASS
MULTI_LLM_PUBLIC_CLAIMS_ACCURATE: YES
OPEN_GAMBIT_REMAINS_SECONDARY: YES
POLITICAL_EXCLUSION: PASS
PREDICTION_IMMUTABILITY_ATTACK: PASS
FAILURE_MODE_HANDLING: PASS
TYPECHECK: PASS
LINT: PASS
TESTS: PASS
BUILD: PASS
MIGRATION_PARITY: PASS
LOCAL_DEMO: PASS
PRODUCTION_MUTATED: NO
STAGING_MUTATED: NO
SAFE_TO_ENTER_STAGING: CONDITIONAL
SAFE_TO_ENTER_PRODUCTION: CONDITIONAL
NEXT ACTION: Owner reviews and stages a clean release commit, then provisions isolated staging resources for a no-schedule preflight; do not deploy from the current dirty worktree.
FINAL DECISION: READY_AFTER_OWNER_ACTION
