# Tibo Classifier Resilience Repair — 2026-09-09

Repository: `codex-monitor`
Scope: Tibo Monitor classifier boundary and reset-completion admission
Production mutation during this repair: **NO**

## Confirmed Incident

The forensic audit confirms that the Tibo Cron continued to run on `*/15 * * * *`, X ingestion continued, source posts persisted, the cursor/checkpoint advanced correctly, and the D1/public event query path remained healthy.

The classifier boundary returned HTTP 400 for approximately 18 hours. Source posts were therefore stored but could not become events. After a later Secret Change, the next natural Cron classified backlog posts and created an event.

The confirmed operational condition is:

> `CLASSIFIER_CREDENTIAL_OR_PROVIDER_CONFIGURATION_FAILURE`

The exact secret identity is **not proven**. In particular, this report does not claim that the Sep 7 Secret Change definitely changed `LLM_API_KEY`.

## Exact Root Cause

**CONFIRMED:** the external classifier/provider configuration was unhealthy: natural classifier calls returned HTTP 400, and a later credential/configuration change was followed by successful natural classification.

**INFERRED:** the Secret Changes are temporally associated with the outage and recovery, but the deployment log does not expose the changed secret name or value. The Worker does not own or automatically rotate provider credentials.

The repair therefore treats HTTP 400/401/403-class failures as bounded provider/configuration failures, without assuming a particular secret or vendor-specific cause.

## Retry Counter Root Cause

The old failure path performed a caller-side read/modify/write:

```text
currentAttempts = post.classification_attempts + 1
UPDATE source_posts SET classification_attempts = currentAttempts
```

That is not an atomic increment. Two classifier writers using the same stale `SourcePost` snapshot could both calculate `1` and both write `1`. The run history recorded each failed classifier call independently, so multiple run-level errors could coexist with a final row value of `1`.

The code audit establishes the defect: `updateClassificationRetry()` accepted and assigned a caller-supplied snapshot. It also establishes what did **not** reset the counter: the retry query only selected rows, `markClassified()` was reached after a successful/non-error decision, and the source upsert did not assign `classification_attempts`.

The exact production writer interleaving is **INFERRED, not directly observable**: the audit contains aggregate run errors but no per-write transaction/audit record identifying whether overlapping natural/manual paths supplied the stale snapshot. The repair replaces the vulnerable assignment with an atomic bounded SQL increment, so the counter reflects every retry writer even when calls overlap.

## Timeout Fix

`LLMClassifier.classify()` now uses an explicit `AbortController` timeout of 30 seconds. The timer is deterministic, is cleared in `finally`, and the request includes the runtime-compatible `AbortSignal`.

Timeouts return the bounded existing `ERROR` shape with:

```text
error = TIMEOUT
failureKind = TRANSIENT_PROVIDER_ERROR
```

No provider response body, model output, secret, or raw exception is logged or persisted. There are no retry loops inside one classifier call; the scheduled queue remains responsible for retries.

## Failure Taxonomy

The additive taxonomy is stored in `source_posts.classification_failure_kind`:

| Kind | Examples | Queue behavior |
|---|---|---|
| `TRANSIENT_PROVIDER_ERROR` | timeout, network error, 408/425/429, 5xx | stays recoverable with bounded backoff |
| `PERMANENT_OR_CONFIGURATION_ERROR` | deterministic 4xx such as 400/401/403, missing classifier credential | stays recoverable because configuration can later be repaired |
| `CLASSIFIER_OUTPUT_ERROR` | empty, invalid JSON, invalid structured output, unexpected local classifier error | existing bounded quality retry budget applies |

Only bounded codes/statuses are persisted. Legacy rows are classified from their old bounded prefixes by migration `0026_classifier_resilience.sql`; arbitrary legacy text is not copied into new diagnostics.

## Retry / Recovery Design

Migration `0026_classifier_resilience.sql` adds the failure-kind column and recovery index without editing an applied migration.

Provider/configuration failures are not allowed to consume the terminal quality-failure budget. Their retry delay is:

```text
attempt 1: 15 minutes
attempt 2: 30 minutes
attempt 3: 60 minutes
attempt 4: 4 hours
attempt 5+: 6 hours (capped)
```

Classifier-output failures retain a five-attempt cap and a one-hour delay. The per-Cron classifier budget remains five; no aggressive in-call retry or Cron cadence change was added.

When the provider recovers, pending provider-failure rows become eligible automatically after their stored backoff. A successful classification clears pending/error taxonomy state. Event insertion remains idempotent by the existing source-post uniqueness path; duplicate recovery returns no second event.

## Reset Completion Design

The short-completion supplement is deliberately contextual, not a text-only `reset + everyone` rule. It requires all of the following:

1. canonical direct X evidence from the verified `@thsottiaux` account and matching post identity/URL;
2. either a current trusted reset lifecycle with direct/official verification and a planned/time-change event reference, or a recent (48-hour) direct/official `RESET_PLANNED` event from the canonical Tibo source;
3. strong completion language and broad audience language;
4. no same-sentence contradictory non-Codex product/context signal.

The accepted short-completion forms include:

```text
All reset for everyone.
Reset done for everyone.
Everyone should be reset now.
```

The active/recent lifecycle evidence supplies the missing Codex context. Outside that trusted context, the rule fails closed. Router resets, Astra/Claude/Gemini session resets, demo-environment resets, song lyrics, indexed/unverified copies, and other generic text are not promoted automatically.

Post 205’s equivalent wording — `All reset for everyone. Enjoy the week with Astra.` — is admitted only when the trusted prerequisites are present; `Astra` in the neighboring signoff sentence is not treated as a product-scope override by itself. A conflicting product phrase in the reset sentence remains a rejection.

## Internal Health Behavior

The existing operational `/api/health` path now reports a sanitized classifier state:

```text
availability: healthy | degraded | unavailable
lastSuccessAt
lastErrorAt
lastErrorCode
lastFailureKind
```

The underlying `provider_status.llm-classifier` row records `ok`, `degraded`, or `not_configured` with bounded error codes only. No provider name, HTTP body, secret, raw response, failure counter, retry detail, or source count was added to the normal public timeline or Open Gambit UI. No operational dashboard was introduced.

Run semantics remain intentionally distinct: a Cron may be `status='completed'` when its mechanical work finished while `error_message` records classifier degradation. This preserves healthy zero-event runs as completed while allowing the existing health architecture to report degraded provider state.

Historical `monitor_runs.status='running'` rows with no `finished_at` are observability artifacts from interrupted Worker executions. They do not block future Cron execution. This repair does not mutate those historical rows and does not add a broad cleanup system.

## Tests

Focused resilience tests cover:

- explicit classifier timeout and `AbortSignal` use;
- HTTP 400/configuration and HTTP 503/transient handling;
- no raw provider-body logging;
- atomic retry-counter SQL semantics;
- bounded provider backoff and separate output-failure cap;
- provider-failure persistence, automatic recovery, and duplicate-event protection;
- the natural-equivalent scheduled path;
- trusted contextual reset completion, post-205-equivalent wording, unverified-source rejection, and all requested false-positive fixtures.

Results:

| Gate | Result |
|---|---|
| Focused tests | PASS — 6 files, 64 tests |
| Full tests | PASS — 37 files, 482 passed, 1 skipped |
| Typecheck | PASS |
| Lint | PASS |
| Build | PASS |
| Migration parity | PASS — latest migration `0026_classifier_resilience.sql`, 26 migrations, 0 FK violations |
| Open Gambit demo | PASS — 2 tests |
| `git diff --check` | PASS |

## Staging Evidence

### LOCAL_SYNTHETIC_ACCEPTANCE

PASS. The isolated local synthetic acceptance test uses a TEST_ONLY-style direct Tibo post and an intentionally unavailable/configuration-error classifier:

1. the post enters pending state;
2. no event is fabricated during provider failure;
3. the atomic retry state remains recoverable;
4. a later natural-equivalent run after the backoff succeeds;
5. exactly one event is created;
6. a later duplicate retry creates no second event.

This was run locally with fake repository/provider state; it did not write production D1/R2 or public content. The earlier report label `STAGING: PASS` meant only this local synthetic acceptance and did not mean that a remote Worker had been deployed; the matrix below separates the two claims.

The capability smoke check was exercised with each of `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` missing. It made no network request and returned the bounded diagnostic `CLASSIFIER_SMOKE_BLOCKED_MISSING_CONFIGURATION` with only missing variable names. It did not run against a live provider.

### REMOTE_STAGING

PARTIAL PASS, with the release gate blocked by missing classifier configuration. The isolated staging resources are Worker `codex-monitor-staging`, D1 `codex-monitor-staging-db` (`27381126-7f62-4bcb-a203-32e0c9047ebd`), R2 `codex-monitor-staging-gambit-snapshots`, and Workflow `gambit-analysis-staging`; staging has no automatic Cron trigger. The final candidate `65787906ef255def5f80845be91223a00d111e01` was deployed as Worker version `302c29b5-4deb-4ba3-8c5e-c9a5e97ae689`.

Migration verification passed remotely: the migration ledger ends at `0026_classifier_resilience.sql`, `source_posts.classification_failure_kind` and `idx_source_posts_classifier_recovery` exist, the D1 row set has no invalid failure-kind values, and `PRAGMA foreign_key_check` returned no rows.

The remote synthetic failure path passed. One TEST_ONLY pending post produced no event, retained `classification_pending = 1`, accumulated `classification_attempts = 1`, persisted `PERMANENT_OR_CONFIGURATION_ERROR` with bounded `LLM_NOT_CONFIGURED`, and an immediate equivalent run made zero classifier calls because the 15-minute backoff was active. The fixture was deleted afterward; final staging D1 checks found zero TEST_ONLY source posts and events.

The live classifier smoke was intentionally blocked before network access: staging secret inventory contains only `GAMBIT_ADMIN_TOKEN` and `GAMBIT_LLM_API_KEY`, with no explicit `LLM_API_KEY`, `LLM_BASE_URL`, or `LLM_MODEL`. No production credential, provider default, or second provider was substituted. Therefore the healthy-provider recovery half, remote duplicate-event recovery, and remote reset-context fixture were not run and cannot be certified from this environment.

Final staging `/api/health` was read-only and sanitized: `dbConnected=true`, `classifier.configured=false`, `status=not_configured`, `availability=unavailable`, and `lastErrorCode=LLM_NOT_CONFIGURED`; no provider name, credential, response body, or raw diagnostic was exposed. The temporary staging-only `CRON_SECRET` used for the failure-path harness was deleted afterward.

## Production Release Status

The final candidate is deployed to **isolated remote staging only**. Production was not deployed: no production migration was applied, no production source post was replayed, no production event was created, and no production secret/variable/cron was changed.

The release validation script is `scripts/check-classifier-capability.mjs`, exposed as `npm run classifier:smoke`. It performs only a provider capability/structured-response check, uses a TEST_ONLY prompt, writes no D1/R2/public data, and never prints the secret or raw response. It must be explicitly run against the intended non-production or release-validation environment after a secret/deployment change.

Tibo Cron remains `*/15 * * * *`. Open Gambit remains `30 2 * * *`; its discovery, 14-source configuration, global Top-K, publication gates, workflow, translation, budget, and scheduling were not changed.

## Remaining Risks

- The exact secret changed in the production incident remains unknown; direct deployment-log evidence would be needed to identify it.
- There is still one external classifier provider and no automatic credential rotation, by design.
- Provider/configuration rows retry every six hours at the cap while pending; this is bounded and budgeted but can retain a long-lived queue during an unresolved outage.
- Historical stuck-run rows remain for audit fidelity; they do not affect future execution.
- `/api/health` remains an existing operational endpoint. No new public dashboard or timeline observability surface was added.
- Remote staging verification remained isolated and stopped at the missing explicit classifier configuration rather than borrowing production credentials. A staging provider configuration is required before the live smoke and healthy-recovery gates can pass.
- Production deployment remains separately unauthorized and out of scope.

## Final Matrix

```text
CLASSIFIER_TIMEOUT:                         PASS
CLASSIFIER_SMOKE_CONFIGURATION_GATE:        PASS
CLASSIFIER_SMOKE_BLOCKED_MISSING_CONFIG:    PASS
RETRY_COUNTER_ROOT_CAUSE_IDENTIFIED:        YES
RETRY_COUNTER_FIXED:                        YES
PROVIDER_FAILURE_POSTS_RECOVERABLE:         YES
RETRY_BACKOFF_BOUNDED:                      YES
PROVIDER_RECOVERY_AUTOMATIC:                YES
DUPLICATE_EVENT_PROTECTION:                 PASS
RESET_COMPLETION_CONTEXT_RULE:              PASS
POST_205_EQUIVALENT_FIXTURE:                PASS
RESET_FALSE_POSITIVE_FIXTURES:              PASS
INTERNAL_CLASSIFIER_HEALTH:                 PASS
PUBLIC_OBSERVABILITY_EXPOSED:               NO
TIBO_CRON_CHANGED:                          NO
OPEN_GAMBIT_CHANGED:                        NO
MIGRATION_ADDED:                            0026_classifier_resilience.sql
FOCUSED_TESTS:                              PASS
FULL_TESTS:                                 PASS
TYPECHECK:                                  PASS
LINT:                                       PASS
BUILD:                                      PASS
MIGRATION_PARITY:                           PASS
LOCAL_SYNTHETIC_ACCEPTANCE:                 PASS
REMOTE_STAGING:                             FAIL (classifier config missing)
REMOTE_STAGING_DEPLOYED:                    YES
REMOTE_STAGING_MIGRATION_0026:               PASS
REMOTE_STAGING_CLASSIFIER_SMOKE:            BLOCKED_MISSING_CONFIGURATION
REMOTE_STAGING_RECOVERY:                    BLOCKED_MISSING_CONFIGURATION
REMOTE_STAGING_DUPLICATE_PROTECTION:        NOT_RUN
REMOTE_STAGING_RESET_CONTEXT:               NOT_RUN
STAGING_HEALTH_SANITIZED:                   PASS
PRODUCTION_DEPLOYED:                        NO
PRODUCTION_MUTATED_BEFORE_AUTHORIZATION:    NO
FINAL DECISION:                             BLOCKED
```
