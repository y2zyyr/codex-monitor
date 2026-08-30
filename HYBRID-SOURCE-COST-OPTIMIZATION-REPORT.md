# Tibo Monitor Hybrid Source Cost Optimization Report

Date: 2026-08-26 (Asia/Shanghai)

Production: https://tibo.modelyard.dev/

Deployment: Worker version `6c49f31a-2e9b-40b4-a153-e4702a159720`

## Decision

Implemented a hybrid source architecture:

- Web Search is the hourly discovery and community-evidence source.
- X API is a low-frequency authoritative verification source.
- The existing single Cron remains `0 * * * *`.
- Search failure never triggers an immediate X API fallback.
- No events, source posts, SEO URLs, bilingual routes, classifier model, or countdown semantics were removed or reset.

## Previous X API Usage Pattern

The pre-change production path selected X as the hourly source. The audit showed hourly runs checking the same 19 posts and an X provider success on each old hourly run. The old run schema did not count logical provider operations, so the historical `x_api_calls` column is not treated as a retroactive HTTP-cost ledger.

## New Architecture

Each hourly run now performs:

1. Web Search discovery.
2. URL/account validation, canonical normalization, keyword prefilter, deduplication, and classification.
3. Provisional event creation when indexed evidence is clear.
4. Confirmation search when a reset is due or confirming.
5. Beijing-time schedule and atomic D1 budget check.
6. Optional one logical X authoritative sync.
7. Source/event upgrade and provider/run usage recording.

## Web Search Provider

The deployed provider uses the documented Brave Web Search API when `BRAVE_SEARCH_API_KEY` is present. A Google Custom Search JSON API compatibility path remains for an already-owned Google setup. No HTML scraping, Nitter mirror, or LLM self-search is used.

Brave API documentation: https://brave.com/search/api/ and https://api-dashboard.search.brave.com/api-reference/web/search/get

Current production status: `OWNER_ACTION_REQUIRED`. No Brave or Google search credential is configured, so `/api/status` reports `source_not_configured` and `/api/health` reports `degraded`. No paid service was purchased automatically.

## X API Daily Budget

`MAX_X_API_FETCHES_PER_DAY = 2` is a code-level hard cap. `X_API_DAILY_LIMIT` is clamped to the range 0..2, so a bad deployment variable cannot raise the product limit.

The budget is persisted in `provider_usage` with a unique `(provider, usage_date)` key. A conditional upsert atomically reserves the logical sync before the X request. A failed attempt remains consumed, preventing retries from bypassing the limit.

## X API Schedule

Default configuration:

```text
X_API_DAILY_LIMIT=2
X_API_SYNC_HOURS=09,21
timezone=Asia/Shanghai
```

The corresponding UTC windows are 01:00 and 13:00. `X_API_DAILY_LIMIT=1` is supported and uses the first configured window, 09:00 Beijing by default. `X_API_MAX_PAGES_PER_SYNC=1` is the default and is capped at 2.

## Budget Persistence

Migration `0005_provider_usage_budget.sql` adds the usage table and run counters. Remote D1 reports no unapplied migrations; `schema_version=5`. The migration copied the existing source/event/reset graph while preserving IDs and foreign-key relationships.

## X API User-ID Cache

The provider reads `x_api_user_id:thsottiaux` from D1 settings and only resolves the username when that cache is empty. The first successful authoritative sync warms the cache; subsequent syncs use `/users/:id/tweets`. `X_API_USER_ID` is also supported as an optional single-account configuration.

## Incremental Sync

The last successful newest tweet ID is stored as `x_api_since_id:thsottiaux`. Normal syncs request only posts after that ID, use one page, and update the cursor only after a successful timeline response. A 404 timeline response clears and re-resolves the cached user ID once.

## Search Discovery

Discovery rotates a pool of query templates and sends at most two discovery queries per hourly run. The default Web Search budget is 48 logical requests per Beijing day. When a reset is due, one discovery query plus one confirmation query is used instead of expanding the hourly request count.

## Indexed Evidence

Search hits are stored as `source_quality=INDEXED`, `verification_status=INDEXED_ONLY`, and `first_discovered_via=web_search`. An indexed search timestamp is never copied into `published_at`; it remains `NULL` unless an authoritative source supplies the real publication time. Indexed classification confidence is capped separately from evidence quality.

## Canonical Upgrade

X status URLs are normalized to `canonical_platform=x` and the numeric `canonical_post_id`. A canonical unique index and repository upsert path ensure that a Search result and the later X result share one source post. The direct result upgrades text, publication time, URL, quality, verification metadata, and preserves `first_discovered_via=web_search`.

## Provisional Events

Clear indexed candidates can create a provisional event immediately. Timeline reads hide `REJECTED` events but preserve them for audit. A later direct result updates the existing event rather than inserting a duplicate.

## Direct Verification

The X sync marks the source/event `DIRECT` and `DIRECT_VERIFIED`, sets `last_verified_via=x_api` and `verified_at`, and upgrades any linked reset cycle. Missing/invalid direct verification can be marked `REJECTED` without silently deleting the audit trail.

## Reset Countdown Integration

Indexed reset announcements can create a countdown with `INDEXED_ONLY` provenance. The UI distinguishes “Reset schedule discovered / Awaiting direct verification” from a directly verified schedule in both English and Chinese. Time extraction remains an LLM classification step followed by programmatic absolute-time resolution.

## Confirmation Search

When a reset is `DUE` or `CONFIRMING`, Web Search runs confirmation queries. Positive evidence must be after the expected reset, have an explicit restoration/reset meaning, contain at least three independent URLs, and span at least two domains. Duplicate URLs, undated indexed evidence, and pre-reset evidence do not count.

## Provider Usage Metrics

`monitor_runs` now records `x_api_calls`, `web_search_calls`, and `llm_classifications`. `/api/status` and `/api/health` expose non-sensitive provider data, including daily limit, used today, last fetch, last success, and next scheduled X sync. Secrets are not returned.

## Health Semantics

Health no longer expects an X request every hour. X is overdue only after an expected Beijing sync window has passed without a successful authoritative sync. Discovery health is based primarily on Web Search and classifier availability. The current production `degraded` state is expected until a real Web Search credential is configured.

## Tests

- `npm test`: 129 tests passed in 12 files.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Budget tests cover 1/day, 2/day, duplicate/manual triggers, next-Beijing-day reset, and a 24-hour equivalent hourly execution.
- Hybrid-source tests cover query rotation, strict account validation, canonical IDs, indexed publication-time integrity, community evidence thresholds, and evidence deduplication.

## D1 Migration

Remote migration `0005_provider_usage_budget.sql` applied successfully. It is append-only at the migration level and does not drop the production database or delete existing event/source-post data. Existing production graph rows were copied with IDs and relationships intact.

## Deployment

The Worker was deployed with one Cron trigger, `0 * * * *`, and the following non-secret variables:

```text
X_API_DAILY_LIMIT=2
X_API_SYNC_HOURS=09,21
X_API_EMERGENCY_VERIFY=false
X_API_MAX_PAGES_PER_SYNC=1
X_API_MAX_RESULTS_PER_PAGE=20
WEB_SEARCH_ENABLED=true
MAX_WEB_SEARCH_REQUESTS_PER_DAY=48
```

## Production Verification

Verified after deployment:

- `/api/status`, `/api/health`, `/api/events`, `/`, and `/zh/` return HTTP 200.
- `/api/status` exposes the new provider usage fields.
- X is configured with daily limit 2; the next legal sync shown by the API is `2026-08-26T13:00:00.000Z` (21:00 Beijing).
- `provider_usage` exists and currently has no rows because no post-deploy authoritative/search request has been made.
- `POST /__cron/trigger` returns 503 because `CRON_SECRET` is not configured; it cannot be used as an unguarded budget bypass.

## X Calls Per Day Verified

The automated 24-hour equivalent test produces exactly two logical X sync reservations, at 09:00 and 21:00 Beijing; a third same-day reservation is rejected. This verifies the hard guard independently of Cron configuration.

A complete natural 24-hour production observation is still pending: the deployment occurred shortly after the last recorded hourly run, before the next new-architecture Cron tick and before the next 21:00 Beijing X window. It must be confirmed from `provider_usage` and `monitor_runs` after those windows.

## Estimated Cost Reduction

At the product-operation level, X authoritative sync frequency falls from at most 24 hourly syncs/day to at most 2/day: a 91.7% reduction in logical X sync frequency before accounting for provider-specific subrequest pricing. Search is capped at 48 logical requests/day. Dollar savings depend on the current X plan and are intentionally not fabricated.

For Brave's published list price of $5 per 1,000 requests, 48 requests/day would be approximately 1,440 requests/month, or about $7.20/month before any current credit or plan terms. See https://brave.com/search/api/. Google documents 100 free Custom Search queries/day, but its official overview also says the product is closed to new customers and scheduled for discontinuation on January 1, 2027: https://developers.google.com/custom-search/v1/overview.

## Remaining OWNER_ACTION_REQUIRED

1. Obtain and store a legitimate Web Search credential, preferably `BRAVE_SEARCH_API_KEY`, using the Cloudflare secret store. Do not put it in `vars` or commit it.
2. After adding the secret, allow the hourly Cron to run and verify `web_search` usage and successful discovery.
3. Optionally set `X_API_USER_ID` if the known Tibo user ID is available; otherwise the first scheduled sync will resolve once and persist it.
4. Observe one natural Beijing day, including the 09:00 and 21:00 windows, and confirm `provider_usage(provider='x_api') <= 2` and matching `monitor_runs.x_api_calls <= 2`.

Overall status: implementation and automated verification PASS; production hybrid discovery and natural-day cost verification remain OWNER_ACTION_REQUIRED until a Web Search credential is supplied and one full production day is observed.
# Historical phase report

This document records the earlier hybrid-source phase. The current source
architecture is Direct X timeline first with indexed search as a backstop;
see `INCREMENTAL-SOURCE-IMPLEMENTATION-REPORT.md` for the active settings.
