# Tibo Monitor Adaptive Search Budget Report

Date: 2026-08-26 (Asia/Shanghai)

Production: https://tibo.modelyard.dev/

Deployment: Worker version `1a36ae81-f36e-422b-b0d6-5d46434626e5`

## Decision

Replaced fixed hourly Web Search execution with state-aware adaptive cadence. The existing single Cron remains `0 * * * *`; each hourly tick now decides whether a search cycle is due before making any provider request. X API scheduling and budget are unchanged.

## Previous Search Budget

The previous default was up to 48 Web Search requests/day and the production Cron path attempted discovery every hour, commonly using two query requests per run. This could reach 48 provider requests/day even when there was no active reset.

## New Adaptive Modes

- `NORMAL`: no active reset cycle.
- `WATCHING_RESET`: a scheduled/time-changed reset exists and is not yet due.
- `CONFIRMING_RESET`: reset is due, confirming, expired-unconfirmed, or its expected time has passed.

The D1 reset cycle is advanced from `SCHEDULED`/`TIME_CHANGED` to `DUE` when `expected_reset_at` is reached. `CONFIRMED` and rejected/cancelled-style states return to normal cadence.

## Normal Cadence

Default: `NORMAL_SEARCH_INTERVAL_HOURS=2`.

One rotated broad query is executed per eligible cycle. The default projection is:

```text
12 cycles/day × 1 query/cycle = 12 Web Search requests/day
12 × 30 = 360 estimated requests/month
```

The interval can be configured to 3 hours without changing active-reset behavior.

## Reset Watching Cadence

`WATCHING_RESET` runs at most once per hour and rotates focused Tibo queries such as:

- `site:x.com/thsottiaux/status reset Codex`
- `"thsottiaux" Codex reset`
- `site:x.com/thsottiaux/status clarification Codex`

One query per cycle is the default, which allows an all-day reset watch to remain within the 24-request daily budget.

## Confirmation Cadence

`CONFIRMING_RESET` runs at most once per hour and rotates direct/community confirmation queries such as:

- `Codex reset usage restored today`
- `Tibo Codex reset`
- `site:reddit.com Codex usage reset`
- `site:x.com Codex reset usage restored`

The confirmation search remains Web Search only; it never triggers an extra X API request.

## Daily Hard Limit

Default configuration:

```text
MAX_WEB_SEARCH_REQUESTS_PER_DAY=24
```

Each `SearchProvider.search()` call reserves one D1 `provider_usage` unit. A query rejected by the atomic budget guard does not increment `monitor_runs.web_search_calls` and does not issue HTTP. Provider/network failures after reservation count as attempted provider requests.

## Query Rotation

Normal mode executes exactly one query and rotates across three broad templates. Watching mode rotates focused reset/clarification templates. Confirming mode rotates direct, official, X, and community-oriented templates. Query count is not hidden behind a Cron-run count; one query equals one provider request.

## X API Budget Preservation

X remains unchanged:

```text
X_API_SYNC_HOURS=09,21
X_API_DAILY_LIMIT=2
MAX_X_API_FETCHES_PER_DAY=2
```

Search cadence decisions are independent from X cadence. Search errors, skipped search ticks, watching mode, and confirming mode do not create an emergency X request. X can run only when its own Beijing schedule and D1 budget allow it.

## Health Semantics

Health freshness now uses the current search mode and the last successful search cycle. A skipped hourly Cron is healthy when NORMAL's two-hour interval has not elapsed. The exact `nextSearchAt` boundary is not reported stale before the next Cron opportunity. Exhausting the configured daily search budget is treated as waiting for the next Beijing day rather than as an hourly failure.

## Cost Projection API

`/api/status` and `/api/health` now expose non-sensitive estimated fields:

```json
{
  "requestsToday": 0,
  "dailyLimit": 24,
  "currentMode": "NORMAL",
  "nextSearchAt": "...",
  "estimatedMonthlyRequests": 360,
  "estimatedMonthlyGrossCostUsd": 1.8,
  "monthlyCreditUsd": 5
}
```

Pricing is informational configuration, not a control path:

```text
BRAVE_SEARCH_PRICE_PER_1000_USD=5
BRAVE_MONTHLY_CREDIT_USD=5
```

## 24h Normal Simulation

Simulating 24 hourly Cron executions with no active reset produces exactly 12 eligible Web Search requests. The other 12 hourly ticks are skipped without consuming budget.

```text
NORMAL_DAY_WEB_REQUESTS=12
```

## 24h Reset Simulation

Simulating an all-day `WATCHING_RESET`/`CONFIRMING_RESET` state produces one eligible request per hour and stops at the hard budget.

```text
RESET_DAY_MAX_WEB_REQUESTS=24
```

## Estimated Monthly Search Volume

```text
NORMAL:            360 requests/month, gross estimate $1.80/month
WATCHING/CONFIRM:  720 requests/month, gross estimate $3.60/month
X API:             <=2 logical syncs/day
```

At the configured Brave list-price estimate of $5/1,000 requests, normal cadence is below 1,000 requests/month and fits inside the configured $5 monthly credit assumption. The estimate is not a purchase or billing guarantee. Official pricing: https://brave.com/search/api/

## Tests

- `npm test`: 139 tests passed in 13 files.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Adaptive mode transitions and reset-due transition.
- NORMAL two-hour cadence and query rotation.
- WATCHING/CONFIRMING hourly cadence.
- Confirmed/reset-rejected return to NORMAL.
- Daily hard limit and next-search calculation.
- Real provider request budget accounting: the third request is rejected before HTTP.
- Skipped hourly tick does not count.
- Search failure does not make an unscheduled X sync eligible.
- Health freshness follows current cadence.
- 24-hour normal and reset simulations.

## Deployment

Deployed with one Cron trigger:

```text
0 * * * *
```

Non-secret production vars now include:

```text
MAX_WEB_SEARCH_REQUESTS_PER_DAY=24
NORMAL_SEARCH_INTERVAL_HOURS=2
BRAVE_SEARCH_PRICE_PER_1000_USD=5
BRAVE_MONTHLY_CREDIT_USD=5
```

No D1 migration was needed in this round. Remote D1 reports no unapplied migrations. Existing events/source posts were not deleted or reclassified.

## Production Verification

Verified after deployment:

- `/api/status`, `/api/health`, `/api/events`, `/`, and `/zh/` return HTTP 200.
- Production `/api/status` reports `currentMode=NORMAL`, `dailyLimit=24`, `estimatedMonthlyRequests=360`, and X daily limit 2.
- `provider_usage` is present and currently empty because no Web Search credential is configured and no post-deployment provider request has been made.
- `POST /__cron/trigger` remains protected and returns 503 because `CRON_SECRET` is not configured.
- The single production Cron remains hourly; no additional Cron was created.

## Remaining OWNER_ACTION_REQUIRED

1. Add a legitimate `BRAVE_SEARCH_API_KEY` to Cloudflare secrets. No Search service was purchased automatically.
2. Let the deployed Worker execute one natural day and verify `provider_usage` plus `monitor_runs.web_search_calls` against the two projections above.
3. Confirm the first scheduled X sync still stays within `X_API_MAX_PER_DAY=2`.
4. If the Brave plan or credit changes, update the informational vars; cadence and hard budget do not depend on the price values.

Final constants:

```text
NORMAL_DAY_WEB_REQUESTS=12
RESET_DAY_MAX_WEB_REQUESTS=24
X_API_MAX_PER_DAY=2
```

Overall status: implementation, tests, deployment, and API verification PASS. Natural-day production cost verification and live Web Search discovery remain `OWNER_ACTION_REQUIRED` until the Search credential is supplied.
# Historical phase report

This document records the earlier search-budget phase. The current source
architecture is Direct X timeline first with indexed search as a backstop;
see `INCREMENTAL-SOURCE-IMPLEMENTATION-REPORT.md` for the active settings.
