# Modelyard SEO V2 Implementation Report

**Date:** 2026-08-27
**Scope:** `codex-monitor` Worker and SSR pages
**Decision:** **PARTIAL**

The requested SEO V2 implementation is present in the local project and passes the local regression suite. A production deployment was not performed because deployment changes external production state and no explicit deployment authorization or preview hostname was supplied. Production therefore remains at the baseline state until the owner deploys and re-runs the production audit.

## Before / After

| Metric | Before: production audit | After: implementation evidence |
|---|---|---|
| Indexable URLs | 44 technical `index, follow` URLs; no quality policy | 12 URLs in the local fixture sitemap; 54 URLs projected from the current read-only production API dataset after deployment (2 home + 10 landing + 42 eligible event-language URLs) |
| Sitemap URLs | 44; all 21 events in both languages | 12 in local fixture; policy-filtered and canonical-only. Current production data passes the event gate for 21/21, so projected deployed count is 54 |
| Metadata conflicts | 2 homepage language variants had SSR/hydrated title or description drift | 0 in local hydrated metadata test; SSR and hydrated title/description/OG/Twitter use the same injected source |
| Broken hreflang | 0 observed | 0 in English/Chinese route regression tests; reciprocal pairs use existing route shapes |
| Thin indexable pages | Unknown; no index policy | 0 in local sitemap; incomplete/pending events are noindex,follow. Current production dataset has 21/21 passing the implemented completeness gate |
| Events with provenance | 21/21 current records had source fields, but no explicit policy | 2/2 local fixture records; current read-only production dataset 21/21 has source URL, source post, and discovery method |
| Events with verification | 21/21 (`10 DIRECT_VERIFIED`, `11 INDEXED_ONLY`) | 2/2 local fixture records; current read-only production dataset 21/21 has a verification status. `INDEXED_ONLY` remains visibly distinct from direct verification |
| Important orphan pages | 5 planned core search entries absent | 0 for the five implemented landing pages: header/footer and contextual links expose them in both languages |
| Structured data types | Home `WebSite` + `ItemList`; event `WebSite` + `BreadcrumbList` | Home `WebSite` + `ItemList`; landing `WebSite` + `BreadcrumbList` (+ `ItemList` when events exist); event `WebSite` + `Article` + `BreadcrumbList`; 404 has none |
| 404 canonical errors | Invalid event canonicalized to homepage; unknown route was empty | 0 locally: branded HTTP 404, `noindex, nofollow`, no canonical, no homepage hreflang |

The “After” column deliberately separates local verification and a read-only production-data projection from a production claim. No production response was changed in this task.

## Files changed

- `src/types.ts`
- `src/utils/index-policy.ts`
- `src/db/repository.ts`
- `src/routes/api.ts`
- `src/renderer.ts`
- `src/index.ts`
- `static/app.js`
- `static/style.css`
- `tests/seo-v2-renderer.test.ts`
- `tests/e2e/seo.spec.ts`
- `package.json`
- `docs/seo/SEO-V2-BASELINE.md`
- `docs/seo/SEO-V2-ARCHITECTURE.md`
- `docs/seo/SEO-INDEX-POLICY.md`
- `docs/seo/SEO-V2-IMPLEMENTATION-REPORT.md`
- `docs/seo/SEO-V2-VERIFICATION-REPORT.md`

## Features implemented

- Replaced the hidden homepage SEO intro with visible, concise purpose/source/unofficial/freshness content.
- Centralized SSR metadata and made hydration reuse the SSR metadata object.
- Kept canonical, hreflang, OG, Twitter, and language values consistent for English and Chinese pages.
- Separated successful monitor freshness, source-fetch freshness, event observation, and event verification timestamps.
- Removed the `LIVE` + `Last Checked —` contradiction and added an explicit unavailable/awaiting state.
- Made SSR and hydrated homepage timeline headings semantic and kept ItemList synchronized after API refreshes.
- Added semantic `main`, `section`, `article`, `nav`, `header`, `footer`, `ol`, `li`, and heading hierarchy improvements.
- Added a branded 404 with HTTP 404, noindex, no canonical, and Home/Latest/Reset History/FAQ navigation.
- Added event `Article` JSON-LD only where the page is semantically an event record. Unsupported author/publisher/image fields are omitted.
- Reused existing provenance fields and derived `Observed` from the source post's real `fetched_at`, without a speculative schema migration.
- Added visible event verification status, source type, source link/excerpt, published/observed/verified dates, confidence, `What does this mean?`, an explicit affected-scope limitation, and historical-context links.
- Added bilingual `/latest/`, `/reset-history/`, `/rate-limit-updates/`, `/faq/`, and `/methodology/` routes.
- Built reset history from database events grouped by year/month and rate-limit updates from explicit existing categories, not string matching.
- Added a conservative, separate event index-eligibility policy and made sitemap output obey the same policy.
- Added reciprocal bilingual links and contextual internal links without inventing related-event or superseding relationships.
- Added automated renderer, policy, metadata, hydration, API-header, sitemap, 404, JSON-LD, and bilingual route regression checks.

## ALREADY_RESOLVED findings

The first audit already had some useful foundations. They were retained and covered by the V2 checks rather than unnecessarily rewritten:

- The production canonical host and old-domain redirect path already existed.
- Existing API `X-Robots-Tag` noindex behavior was preserved and extended to HEAD responses.
- Existing bilingual self/reciprocal hreflang structure was retained and extended to the new page pairs.
- Existing D1 provenance and verification fields were reused rather than replaced with duplicate concepts.
- Existing event ID URLs were kept stable; no slug migration was introduced.

## Official guidance checked

Implementation decisions were checked against current Google Search Central guidance for [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies), [localized versions](https://developers.google.com/search/docs/advanced/crawling/localized-versions?hl=en), [canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [robots meta tags](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [spam policies](https://developers.google.com/search/docs/essentials/spam-policies), and [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals). Structured data was treated as a representation of visible content, not as a guarantee of a rich result.

## Remaining risks

- Google indexing and canonical selection have not been verified; indexing can be delayed or differ from sitemap eligibility.
- `GSC_OWNER_ACTION_REQUIRED` and `BING_OWNER_ACTION_REQUIRED`: no owner credentials were available.
- `FIELD_CWV_NOT_AVAILABLE`: no field Core Web Vitals dataset was available. A lab timing sample is not reported as field CWV.
- Existing event summaries and classifications remain data-quality dependent; the implementation does not rewrite them or invent unsupported facts.
- Unverified/indexed-only events can remain visible for historical usefulness, but they are explicitly labelled and may be noindex when they fail the content/evidence gate.
- Production has not received this code, so post-deploy status and sitemap counts must be checked again.

## Owner actions

1. Review the diff and deploy through the normal Cloudflare Pages/Workers release path.
2. If a preview environment exists, set `E2E_BASE_URL` to its host and run the SEO smoke suite before production.
3. After deployment, fetch the route matrix in `SEO-V2-VERIFICATION-REPORT.md`, inspect one latest English and Chinese event, and submit `https://tibo.modelyard.dev/sitemap.xml` to Google Search Console and Bing Webmaster Tools.
4. Verify the domain/property in GSC and Bing, inspect `/`, `/latest/`, the latest English event, and the latest Chinese event, then review indexing reports.
5. Supply real field CWV data if performance decisions are required.
