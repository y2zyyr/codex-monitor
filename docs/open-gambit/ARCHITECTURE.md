# Open Gambit V1 — local architecture and release boundary

Status: implemented and verified locally on 2026-09-04. This document describes the code in this repository; it is not a production deployment record.

## Purpose and scope

Open Gambit is an isolated strategic-analysis column inside the existing Tibo Worker. It covers AI, models, APIs, software, products, companies, protocols, developer ecosystems, infrastructure, standards, pricing, acquisitions, and competitive dynamics. Hard political content is rejected before analysis and is never silently converted into technology commentary. The feature is deliberately secondary to the existing Tibo Codex monitor.

The existing monitor remains the primary product and keeps its existing `*/15 * * * *` cadence. Gambit has separate code under `src/open-gambit/`, separate `gambit_*` tables, separate metrics, separate admin routes, and separate schedule windows. It does not introduce a second Worker or a second production D1 database.

## Cloudflare-only topology

The deployment shape is:

`existing Worker → existing D1 (additive gambit_* tables) → Workflows binding → private R2 snapshots → external LLM provider`

The local path uses the same boundaries with dependency injection: Wrangler local D1, `MemorySnapshotBucket` as an R2-compatible emulator, and `MockGambitProvider` fixtures. No Queues, AI Gateway, Workers AI, Browser Run, Vectorize, KV, Durable Objects, or auxiliary Worker are required by V1.

`wrangler.example.jsonc` documents the deployment-ready R2 and Workflow bindings with placeholders. The Cloudflare Workflow entrypoint is in `src/open-gambit/workflow-entrypoint.ts`; `src/open-gambit/workflow.ts` contains dispatch/local orchestration. `wrangler.staging.example.jsonc` uses separate staging names and leaves Gambit scheduling disabled. The actual production Wrangler file is outside version control and was not changed by this work.

## Data and provenance

`migrations/0021_open_gambit.sql` is additive and creates only the Open Gambit domain:

- source registry, bounded source snapshots, candidates, candidate/source links, and run records;
- LLM attempts, articles, immutable article revisions, theses, and evidence links;
- immutable original predictions, append-only resolution events, corrections, translations, approvals, daily metrics, and Workflow instances.

The original prediction columns are stored with a canonical JSON SHA-256 hash. Resolution events and corrections carry their own hashes and never overwrite the original statement, probability, target, condition, deadline, reasoning, falsifier, publication timestamp, or prompt version. SQLite triggers also reject UPDATE/DELETE attempts against predictions, resolution events, and corrections. Public trajectories are restricted to 20/30/40/50/60/70/80 probability buckets, absolute deadlines, and one to three trajectories for new publication. A no-trajectory analysis returns NON_FALSIFIABLE; existing historical articles remain unchanged.

`src/provenance.ts` and `scripts/record-provenance.mjs` record only non-secret release metadata: build environment/version, commit SHA, timestamp, schema migration, prompt version, and AI disclosure version. The health response exposes the same metadata without reading credential variables.

## Discovery and evidence policy

The source registry is an explicit allowlist. V1 supports RSS/Atom, official blogs/product pages, GitHub releases, bounded search discovery, and X as supplementary discovery. Discovery fetches only configured URLs; fetched text cannot select arbitrary follow-on URLs.

Evidence fetches require HTTPS, reject local/private/link-local hosts and non-443 ports, re-check every manual redirect against the hostname allowlist, enforce redirect/timeout/body-size caps, validate content types, strip scripts/styles/templates/comments/hidden markup, extract bounded visible text and metadata, normalize URLs, and hash the normalized snapshot. R2 paths are content-addressed as `gambit/snapshots/sha256/<hash>.json`; raw HTML is not stored. Discovery-only sources can provide context but cannot independently support a factual claim.

Model prompts delimit source text as untrusted evidence. Prompt-injection-like text is treated as data, never as an instruction. Provider errors are reduced to bounded codes; request bodies and upstream error bodies are not logged.

`GambitRunBudget` keeps provider namespaces separate (`gambit_llm`, `gambit_search`, `gambit_x`, `gambit_github`, and `gambit_http`) and enforces bounded per-run calls/tokens. Exhaustion returns a review/defer result rather than opening an unlimited retry or spend path. Discovery fails closed before fetching when private R2 is unavailable unless explicit local-memory mode is enabled. The non-HTTP namespaces are reserved for explicitly configured adapters; V1 discovery itself fetches only the configured HTTP source URLs.

## Qualification and staged workflow

The deterministic gate records evidence sufficiency, strategic value, falsifiability, political signals, and explicit rejection reasons such as `POLITICAL_TOPIC_EXCLUDED`, `INSUFFICIENT_EVIDENCE`, `LOW_STRATEGIC_VALUE`, `NON_FALSIFIABLE`, and `NO_GAMBIT_WORTH_PUBLISHING`.

Qualified candidates follow these bounded stages:

1. deterministic qualification;
2. triage for importance, AI/technology relevance, evidence, and political exclusion;
3. evidence-grounded analysis separating facts, obvious logic, Gambit mechanism, beneficiaries/pressured actors, countercase, uncertainty, and trajectories;
4. an independent critic that tries to reject unsupported motives, weak causality, sensationalism, political framing, and unfalsifiable claims;
5. deterministic composition into an immutable draft revision;
6. optional translation after approval, with IDs, numbers, probabilities, deadlines, and conditions checked against the canonical English revision;
7. conservative resolution into HIT, PARTIAL, MISS, EXPIRED, UNRESOLVED, RETRACTED, or SUPERSEDED events.

No LLM output publishes directly. Missing providers or malformed strategic JSON fail closed to `NEEDS_HUMAN_REVIEW`. Workflow IDs are deterministic per candidate, and persisted results are idempotent.

## Publication and review

The public routes are `/open-gambit/`, `/open-gambit/<slug>/`, `/zh/open-gambit/`, and their article equivalents. The small homepage module shows only published non-political articles; it disappears when there is no content. Article pages visibly distinguish `FACT`, `ANALYSIS`, and `AI FORECAST`, include source links, `datePublished`, `dateModified`, `isBasedOn`, canonical URLs, and EN/ZH hreflang metadata. An article's probability is rendered as an AI estimate, not as a score.

The admin console is `/admin/open-gambit/` and does not persist its bearer token in browser storage. Review actions require the separate server-side `GAMBIT_ADMIN_TOKEN` authentication boundary, a bounded idempotency key, and stale-revision acknowledgement when applicable; Gambit does not fall back to the Community admin secret. Only an explicit `APPROVE` action can transition a current revision to publication; rejected or returned revisions cannot publish. Political articles are excluded from public reads even if a bad row exists.

Resolution events are visible only after later evidence exists. The authenticated correction endpoint appends evidence-backed `CORRECTION`, `RETRACTION`, or `SUPERSESSION` history; it never edits an original forecast.

The public AI disclosure is available at `/about/ai/` and `/zh/about/ai/`. It presents the exact visitor-facing `PUBLIC_AI_IDENTITY` values `Claude Fable 5`, `GPT-5.6 Sol`, and `DeepSeek V4 Pro`; these are not API model IDs and never participate in routing. `GAMBIT_LLM_PROVIDER`, `GAMBIT_LLM_BASE_URL`, `GAMBIT_LLM_MODEL`, and explicit role overrides describe the `ACTUAL_RUNTIME_MODEL` configuration independently. Internal LLM-attempt provenance preserves the actual provider/model ID returned by the adapter, role, public identity, prompt version, request hash, timestamp, and usage when known. The disclosure says that not every task invokes every model or identity, that model responsibilities are configurable, that factual claims remain source-grounded, that strategic interpretation and trajectories are AI-labelled estimates, and that V1 requires human approval.

## Local verification

From this project directory:

```bash
npm install
npm run db:migrate:local
npm run typecheck
npm run lint
npm test
npm run migration:parity
npm run open-gambit:demo
npm run build
npm run provenance
```

The demo uses fictional `TEST_ONLY` content and no external network, API key, production D1, R2, Workflow, Cron, DNS, or GitHub release. The parity script applies the complete migration chain to a fresh temporary local D1, checks foreign keys and the Open Gambit schema, actively verifies nine prohibited prediction/history writes are rejected by append-only triggers, verifies append-only writes still succeed, and removes temporary state.

Later, after explicit review and with real staging resources filled into a copied staging configuration, the release operator can run:

```bash
cp wrangler.staging.example.jsonc wrangler.staging.jsonc
npx wrangler d1 migrations apply codex-monitor-staging-db --config wrangler.staging.jsonc --remote
npx wrangler deploy --config wrangler.staging.jsonc
```

After staging sign-off, the same migration and deploy steps may be run against the separately maintained production configuration. Those are release procedures only; they were not run for this task. Production scheduling should remain disabled until the rollout gate is explicitly approved.

## Staging and rollback boundary

Staging must use its own Worker name, D1 database, private R2 bucket, Workflow name, admin secret, LLM secret, and source registry. Apply and verify the additive migration in staging before considering production. Keep `GAMBIT_SCHEDULE_ENABLED=false` until review, then enable only the dedicated Gambit windows. Existing Tibo monitoring must be checked independently before and after any release.

Rollback is code/config rollback plus disabling the Gambit schedule. Existing Tibo tables and routes are not rolled back with Gambit. Gambit rows are retained for audit; do not delete prediction originals or resolution history as part of a release rollback. A production deployment, remote migration, production R2 write, Workflow creation, Cron mutation, DNS change, or GitHub release requires a separate explicit release decision and was not performed for this implementation.

## Early strategic eligibility (2026-09-07)

Source announcements need not contain forecasts. Political and evidence checks precede deterministic strategic-substance eligibility. Evidence-backed event/object combinations admit analysis; routine maintenance and generic keywords alone return LOW_STRATEGIC_VALUE. Candidate falsifiable and its legacy score remain diagnostic only. The eligibility detail and signal types are reproducible from immutable snapshots; no migration is needed. LLM triage, strategy, and an independent critic assess the mechanism and complete forecast. Publication requires 1–3 forecasts, future absolute deadlines, allowed probability buckets, evidence criteria, distinct falsifiers, a mechanism, and a countercase. Translation, semantic invariants, and prediction immutability are unchanged.
