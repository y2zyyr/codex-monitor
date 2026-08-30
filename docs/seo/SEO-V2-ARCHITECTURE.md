# Modelyard SEO V2 Architecture

**Status:** Implemented in the local Worker build; production deployment is not performed by this task.
**Date:** 2026-08-27

## Decision

Keep the existing `/events/:id` and `/zh/events/:id` URL shapes. Add a small, fixed set of bilingual search entry pages, make provenance visible, and let index eligibility depend on evidence plus page usefulness rather than on URL count or verification status alone.

The production canonical host remains `https://tibo.modelyard.dev`. `codex.modelyard.dev` and `codex.modelyard.pages.dev` remain legacy redirect hosts. No dedicated preview/staging host is configured in `wrangler.jsonc`; local production-equivalent verification uses `wrangler dev`.

## Runtime and route model

The site is a Cloudflare Worker with D1 and static assets. The Worker renders HTML for search-facing routes and serves the existing JSON API and assets.

| Area | English | Chinese | Rendering/data source |
|---|---|---|---|
| Home | `/` | `/zh/` | SSR homepage + hydrated dashboard |
| Latest | `/latest/` | `/zh/latest/` | SSR, latest five records |
| Reset history | `/reset-history/` | `/zh/reset-history/` | SSR, all recorded reset categories |
| Rate-limit updates | `/rate-limit-updates/` | `/zh/rate-limit-updates/` | SSR, taxonomy-filtered events |
| FAQ | `/faq/` | `/zh/faq/` | SSR, evidence/methodology FAQ |
| Methodology | `/methodology/` | `/zh/methodology/` | SSR, trust layer |
| Event | `/events/:id` | `/zh/events/:id` | SSR detail page, existing ID URL retained |
| Technical | `/robots.txt`, `/sitemap.xml` | Same host | Worker-generated |
| API | `/api/*` | Same host | JSON, `X-Robots-Tag: noindex, nofollow` |
| Missing route | Any unknown extensionless route | Same language prefix | Branded HTTP 404, noindex, no canonical |

Trailing-slash landing URLs are canonical. The no-slash variants 301 to those URLs. This avoids adding duplicate canonical candidates without changing event URL history.

## Metadata single source of truth

`src/renderer.ts` owns the page metadata model:

- `HOMEPAGE_COPY` owns the default bilingual homepage title and description.
- `LANDING_COPY` owns the bilingual title, description, and visible lede for the five landing pages.
- `renderHead()` writes title, description, canonical, robots, Open Graph, Twitter, hreflang, and JSON-LD.
- The homepage injects the exact SSR title/description into `window.__SSR_META__`.
- `static/app.js` reads that object during hydration and applies the same values to the document title, description, Open Graph title/description, and Twitter title/description. It does not generate a competing homepage title.

The canonical host is a fixed production value in the renderer and client structured-data synchroniser. Preview/local hostnames are never emitted as canonical or sitemap URLs.

## Data and trust layer

The existing event model already contains the main provenance fields:

`source_post_id`, `source_url`, `source_text`, `source_quality`, `evidence_quality`, `verification_status`, `first_discovered_via`, `last_verified_via`, `verified_at`, `published_at`, `effective_at`, `reset_at`, `created_at`, and `updated_at`.

No speculative relationship columns were added. In particular, `supersedes_event_id` and `related_event_ids` are not fabricated when the database has no reliable relationship. Event pages link only to chronological neighbors and same-category records that are actually present.

`observed_at` is a derived API/renderer field mapped from the joined source post's real `fetched_at`; it does not pretend that the event itself was re-published or independently re-verified.

The source taxonomy is kept aligned with the current database values:

- `DIRECT`: direct source data, currently shown as Direct X API where applicable.
- `OFFICIAL`: a source labelled official by the existing ingestion model.
- `INDEXED`: web-search indexed evidence.

Verification status remains a separate dimension: `DIRECT_VERIFIED`, `OFFICIAL_VERIFIED`, `INDEXED_ONLY`, `REJECTED`, with missing/unknown values treated as pending by the index policy. `INDEXED_ONLY` is never rendered as direct verification.

## Freshness semantics

The UI distinguishes three timestamps:

1. `lastCheckedAt` / `lastSuccessfulCron`: the latest completed monitor run with no recorded error.
2. `lastSourceFetch`: the latest successful source/provider fetch.
3. Event `observed_at`: the joined source post fetch time for that record.
4. Event `verified_at`: the event-level verification timestamp, when present.

The status badge uses provider configuration, provider freshness, and the latest successful run. It does not infer `LIVE` from a page render alone. If no successful run exists, the UI says `AWAITING FIRST RUN` / `等待首次运行`; missing event verification remains `Pending verification` or `Not independently verified`.

## Index eligibility and sitemap flow

`src/utils/index-policy.ts` evaluates event eligibility. It requires meaningful bilingual content and provenance, a published or record date, and an allowed verification state. `INDEXED_ONLY` can qualify only when the source excerpt is sufficiently useful for review; it is not automatically indexed or automatically excluded solely because it is indexed evidence.

The five landing pages are rendered regardless of data volume, but dynamic pages become `noindex, follow` when they have no eligible underlying event. FAQ and methodology contain their own substantive visible content and remain eligible. The sitemap receives the same eligibility decisions and contains only canonical production URLs that the page policy allows.

The homepage ItemList and visible event list are built from one SSR array. After an API refresh, the client updates the ItemList from the refreshed array so hydrated structured data does not describe a stale list.

## Information architecture and links

The header and footer link all five core landing pages in both languages. Event pages link to:

- the relevant taxonomy landing page;
- real previous/next chronological records, when present;
- real same-category records;
- the methodology page through the visible historical-context explanation.

Reset history is a database-driven year/month timeline. Rate-limit updates use explicit existing categories (`POLICY_CHANGE` and `RESET_TIME_CHANGED`) rather than keyword matching. FAQ links to methodology, history, and rate-limit updates. No mass topic-page generation is introduced.

## Structured data

- Home: `WebSite` and `ItemList`.
- Landing pages: `WebSite`, `BreadcrumbList`, and `ItemList` only when event records are present.
- Event pages: `WebSite`, `Article`, and `BreadcrumbList`.
- 404 pages: no JSON-LD.

The event `Article` schema contains only fields represented by real event data or visible source context. `author`, `publisher`, and `image` are omitted because the current model does not provide a reliable independent editorial identity or event image. Article schema does not promise a rich result.

Google guidance checked for this implementation:

- [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Structured data general policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Localized versions and hreflang](https://developers.google.com/search/docs/advanced/crawling/localized-versions?hl=en)
- [Canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Robots meta tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)

## Explicit non-goals

- No `/events/:id` to slug migration.
- No account-specific usage balance claims.
- No claim that the monitor is official or real-time.
- No fabricated history, related-event, author, publisher, or policy fields.
- No Search Console or Bing API integration without owner authorization.
- No dedicated preview hostname invented in code or metadata.
