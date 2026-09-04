# Open Gambit V1 — Pre-Staging Release Manifest

Manifest date: 2026-09-04

This manifest records the non-secret release inputs and operator-owned
preconditions for the pre-staging freeze. It is a local audit artifact. It
does not authorize a deployment, remote migration, secret change, or resource
creation.

## Repository state

- Repository: `/Users/kyho/Documents/modelyard_dev/codex-monitor`
- Freeze baseline HEAD: `1a5a7e1`
- Release candidate branch: `codex/open-gambit-v1-staging-candidate`
- The exact clean release commit SHA is recorded in the staging acceptance
  report after the local commit is created.
- Reproducibility boundary: source, migrations, tests, templates, and build
  commands are in the repository; credentials, account identifiers, and
  Cloudflare resource identifiers remain operator-supplied.

## Version and provenance inputs

- Migration high-water mark: `0021_open_gambit.sql`
- Schema/config version: `0021_open_gambit`
- Prompt version: `gambit-prompts-v1`
- AI disclosure version: `v1`
- Build command: `npm run build` (local Wrangler build only)
- Test command: `npm test`
- Supporting checks: `npm run typecheck`, `npm run lint`, `npm run migration:parity`,
  `npm run open-gambit:demo`, and both example-config Wrangler builds
- Freeze verification timestamp: `2026-09-04T16:16:35Z` (UTC)

## Public identity and runtime provenance

`PUBLIC_AI_IDENTITIES: Claude Fable 5 / GPT-5.6 Sol / DeepSeek V4 Pro`

`ACTUAL_RUNTIME_MODEL: configurable; currently verified through the live provider smoke test`

The three names above are visitor-facing presentation identities. They must
not be copied into API model routing automatically. Runtime records should
retain the actual provider, endpoint/model identifier when known, role, prompt
version, request hash, timestamp, and token usage when available.

## Expected bindings

- `DB`: the Worker’s D1 database.
- `ASSETS`: the Worker static-assets binding.
- `GAMBIT_SNAPSHOTS`: a private R2 bucket for bounded source snapshots.
- `GAMBIT_ANALYSIS_WORKFLOW`: the `OpenGambitAnalysisWorkflow` binding.
- One Worker and one D1 database per environment; no second Worker or shadow
  database is required by the V1 design.
- Production's existing monitor cadence remains `*/15 * * * *` in its
  separately maintained configuration. The staging preflight template has no
  automatic cron entries; the dedicated Gambit windows are separately gated
  by `GAMBIT_SCHEDULE_ENABLED` and remain disabled.

## Non-secret configuration inputs

The following names are defined by the templates and must be reviewed per
environment:

- `SITE_URL`
- `GAMBIT_SOURCE_REGISTRY_JSON`
- `GAMBIT_MODEL_ROLES_JSON`
- `GAMBIT_LLM_PROVIDER`
- `GAMBIT_LLM_BASE_URL`
- `GAMBIT_LLM_MODEL`
- `GAMBIT_CRON_WINDOWS`
- `GAMBIT_SCHEDULE_ENABLED`
- `GAMBIT_CONFIG_VERSION`
- `GAMBIT_LOCAL_MEMORY_SNAPSHOTS`
- `GAMBIT_MAX_SOURCES_PER_RUN`
- `GAMBIT_MAX_LLM_CALLS_PER_RUN`
- `GAMBIT_MAX_LLM_TOKENS_PER_RUN`
- `GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN`
- `GAMBIT_MAX_X_REQUESTS_PER_RUN`
- `GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN`
- `GAMBIT_MAX_HTTP_REQUESTS_PER_RUN`
- `GAMBIT_MAX_SOURCE_BYTES`
- `GAMBIT_HTTP_TIMEOUT_MS`

## Required secret names

Values are intentionally absent from this artifact.

- `GAMBIT_LLM_API_KEY`
- `GAMBIT_ADMIN_TOKEN` (separate from `COMMUNITY_ADMIN_TOKEN`)
- Existing Tibo/Community secrets required by the selected deployment, such
  as `CRON_SECRET`, `LLM_API_KEY`, `X_API_BEARER_TOKEN`, and the configured
  Community/Turnstile/GitHub credentials, remain owner-managed and must not be
  copied into this manifest.

## Expected staging resources

The staging template is `wrangler.staging.example.jsonc`. Before staging,
the owner must replace its placeholders with isolated resources:

- Worker: `codex-monitor-staging`
- D1: `codex-monitor-staging-db`
- R2 binding: `GAMBIT_SNAPSHOTS`, private staging Gambit snapshot bucket
- Workflow binding: `GAMBIT_ANALYSIS_WORKFLOW`, named
  `gambit-analysis-staging`, class `OpenGambitAnalysisWorkflow`
- `SITE_URL`: the real staging URL
- Schedule: `GAMBIT_SCHEDULE_ENABLED=false` during preflight

The staging D1 must receive the ordered migration chain only through an
owner-approved staging operation. This audit did not contact or mutate it.

## Expected production resources

Production must use the existing Tibo Worker/D1/assets resources and an
operator-approved private Gambit snapshot bucket and Workflow binding. The
repository templates intentionally do not contain production resource IDs.
The owner must verify the existing migration ledger through `0020` before
applying `0021_open_gambit.sql`, then configure the production equivalents of
the bindings and secret names above. Dedicated Gambit schedules remain
disabled until staging evidence, review, and rollback readiness are complete.

No production resource was queried or mutated during this freeze audit.

## Release acceptance

The release is not self-authorizing from this manifest. Acceptance requires a
clean owner-reviewed commit, isolated staging resources, operator-supplied
secrets, a no-schedule staging preflight, and a separate human decision before
any production migration or deployment.
