# Modelyard SEO V2 Verification Report

**Date:** 2026-08-27
**Decision:** **PARTIAL**

## Verification scope

The code was verified locally with the same Worker entry point and static asset directory used by the deployment build. A local-only D1 fixture contained two representative events: one direct verified event and one indexed-only event. No remote D1 data was written.

Production was audited before implementation for the baseline in [`SEO-V2-BASELINE.md`](./SEO-V2-BASELINE.md). The new Worker was not deployed, so this report does not claim that production has the new routes or metadata yet.

## Command results

| Check | Command/result |
|---|---|
| Lint | `npm run lint` — PASS (`node --check static/app.js` + TypeScript check) |
| Typecheck | `npm run typecheck` — PASS |
| Unit tests | `npm test` — PASS, 14 files / 155 tests |
| Build | `npm run build` — PASS; Wrangler dry-run, 300.81 KiB upload / 66.59 KiB gzip |
| E2E local | `E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e -- tests/e2e/seo.spec.ts` — PASS, 24 passed / 1 skipped |
| Skipped E2E | Legacy-domain redirect is production-only and was intentionally skipped against localhost |
| Local | PASS with `wrangler dev --local --port 8787` and local D1 fixture |
| Preview | `NOT_CONFIGURED`: no dedicated preview/staging hostname exists in `wrangler.jsonc` |
| Production-equivalent | PASS locally through the Worker, SSR renderer, local D1, and static assets |
| Production post-implementation | `NOT_RUN`: no production deployment was authorized/executed |

## Local route audit

| Route | Expected result | Verified result |
|---|---:|---:|
| `/` | 200, indexable, self canonical | PASS |
| `/zh/` | 200, indexable, self canonical | PASS |
| `/events/1` | 200, event Article, provenance fields | PASS |
| `/zh/events/1` | 200, translated Article/event page | PASS |
| `/events/99999` | 404, noindex, no canonical | PASS |
| `/not-a-real-page` | branded 404, noindex, no canonical | PASS |
| `/robots.txt` | 200 text, production sitemap | PASS |
| `/sitemap.xml` | 200 XML, canonical/index-eligible URLs only | PASS |
| `/api/status` | 200 JSON, noindex header | PASS |
| `/api/health` | 200 JSON, noindex header | PASS |
| `HEAD /api/status` | 200, noindex header | PASS |
| Five English landing routes | 200 SSR, canonical, hreflang | PASS |
| Five Chinese landing routes | 200 SSR, reciprocal hreflang | PASS |

## Regression assertions

- Homepage visible intro exists; the former `display:none` SEO block is not used.
- Homepage SSR `h1`/`h2`/`h3` hierarchy and `<ol>/<li>` timeline are present.
- Homepage ItemList length equals the SSR timeline and remains equal after hydration/API refresh.
- Homepage hydrated title, description, OG title/description, and Twitter title/description match the SSR metadata source.
- English/Chinese landing and event hreflang pairs are reciprocal and use only existing route shapes.
- 404 responses have one H1, useful navigation, `noindex, nofollow`, and no canonical to `/`.
- API responses retain `X-Robots-Tag: noindex, nofollow`.
- Event Article JSON-LD parses and uses visible headline, summary, dates, source URL, category, and language. Unsupported author/publisher/image fields are absent.
- Landing ItemLists contain the same event arrays rendered on the page; FAQ has no automatically added FAQPage schema.
- Sitemap excludes API paths, 404 paths, preview/local hostnames, and events failing the eligibility policy.
- Event source/verification labels keep `INDEXED_ONLY` separate from direct verification.

## Current production read-only data projection

The public production API was read without mutation on 2026-08-27:

- 21 total events returned.
- 10 `DIRECT_VERIFIED`, 11 `INDEXED_ONLY`.
- 21/21 pass the current completeness/provenance gate, including the indexed-only source-excerpt gate.
- The post-deployment sitemap is therefore projected at 54 URLs: 2 homepages + 10 landing-page language variants + 42 event language variants.

This projection is not a production response assertion. It must be rechecked after deployment because the database can change.

## Performance and external systems

- A local request timing sample is not a field Core Web Vitals measurement.
- `FIELD_CWV_NOT_AVAILABLE`: no real field LCP/CLS/INP dataset was available.
- The PageSpeed request used during discovery was quota-limited; no lab result is presented as field data.
- `GSC_OWNER_ACTION_REQUIRED`: no Google Search Console property/credentials were available.
- `BING_OWNER_ACTION_REQUIRED`: no Bing Webmaster Tools property/credentials were available.

## Post-deploy checklist

The owner should run the same route matrix against the deployed host, confirm the five English and five Chinese landing pages, inspect the latest event in both languages, submit the production sitemap, and review URL Inspection/indexing reports. Any production mismatch should be treated as a release regression rather than inferred from the local fixture.
