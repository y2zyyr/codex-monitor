# SEO V2 Baseline

**Collected:** 2026-08-27 (Asia/Shanghai)
**Scope:** production `https://tibo.modelyard.dev`
**Project:** `codex-monitor` Cloudflare Worker + D1 + SSR assets

This baseline was captured before the SEO V2 implementation changes in this task. It is intentionally preserved as the before-state reference; post-change results are in `SEO-V2-VERIFICATION-REPORT.md`.

## Host and route context

| Item | Baseline |
|---|---|
| Production canonical host | `https://tibo.modelyard.dev` |
| Legacy host | `https://codex.modelyard.dev` → 301 to production host |
| Preview/staging host | No dedicated preview/staging host is configured in `wrangler.jsonc`; `codex.modelyard.pages.dev` is treated as a legacy redirect host. Local preview is available through `wrangler dev`. |
| Homepage | `/` |
| Chinese homepage | `/zh/` |
| Event page | `/events/25` |
| Chinese event page | `/zh/events/25` |
| Invalid event | `/events/99999` |
| Unknown route | `/not-a-real-page` |
| API | `/api/status`, `/api/health`, `/api/events` |

## Production route matrix

The SSR columns are based on raw HTTP HTML. Hydrated columns are based on a JS-enabled browser after a 1.8 second settling window. API and text/XML endpoints do not have an HTML DOM.

| Route | HTTP | SSR HTML | Hydrated DOM | SSR title | Hydrated title | SSR description | Hydrated description | Canonical | Robots | Hreflang | JSON-LD types | H1/H2/H3 | Internal links |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|---:|
| `/` | 200 | Yes, ~70 KB | Yes, ~72 KB | `Tibo Codex Monitor — Usage Reset & Rate Limit Updates` | `Tibo Codex Monitor — Usage Reset & Rate Limit Tracker` | `Track Codex usage resets, rate-limit changes, Plus limits and subscription policy updates shared publicly by Tibo (@thsottiaux).` | `Track public Codex usage resets, rate-limit changes and subscription policy updates shared by @thsottiaux.` | `/` | `index, follow` | `en`, `zh-CN`, `x-default` | `WebSite`, `ItemList` | 1 / 1 / 0 | 27 |
| `/zh/` | 200 | Yes, ~66 KB | Yes, ~68 KB | `Tibo Codex 监控 — 额度重置、使用限制与政策更新` | `Tibo Codex 监控 — 使用额度、重置与限额追踪` | `追踪 Tibo（@thsottiaux） 公开发布的 Codex 使用额度重置、限额变化、Plus 限制与订阅政策更新。` | `追踪 @thsottiaux 发布的 Codex 使用额度、重置与限额政策动态。` | `/zh/` | `index, follow` | `en`, `zh-CN`, `x-default` | `WebSite`, `ItemList` | 1 / 1 / 0 | 27 |
| `/events/25` | 200 | Yes, ~9 KB | Yes, ~9 KB | Same as hydrated | Same as SSR | 160-character substring of the event summary; currently ends mid-sentence | Same as SSR | Self | `index, follow` | `en`, `zh-CN`, `x-default` | `WebSite`, `BreadcrumbList` | 1 / 0 / 1 | 9 |
| `/zh/events/25` | 200 | Yes, ~8 KB | Yes, ~8 KB | Same as hydrated | Same as SSR | Full Chinese event summary | Same as SSR | Self | `index, follow` | `en`, `zh-CN`, `x-default` | `WebSite`, `BreadcrumbList` | 1 / 0 / 1 | 9 |
| `/events/99999` | 404 | Yes, branded 404 | Yes | `Page Not Found — Tibo Codex Monitor` | Same as SSR | `The requested page was not found.` | Same as SSR | **Homepage** (incorrect for 404) | `noindex, nofollow` | Homepage language alternates | `WebSite` | 2 / 0 / 0 | 1 |
| `/not-a-real-page` | 404 | Empty response body | Not available in browser audit | None | None | None | None | None | None | None | None | None | 0 |
| `/robots.txt` | 200 | Text only | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `/sitemap.xml` | 200 | XML | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| `/api/status` | 200 | JSON | N/A | N/A | N/A | N/A | N/A | N/A | `X-Robots-Tag: noindex, nofollow` | N/A | N/A | N/A | N/A |
| `/api/health` | 200 | JSON | N/A | N/A | N/A | N/A | N/A | N/A | `X-Robots-Tag: noindex, nofollow` | N/A | N/A | N/A | N/A |

## Crawl and index baseline

### robots.txt

```text
User-agent: *
Allow: /
Disallow: /api/
Disallow: /__cron/
Disallow: /*.json

Sitemap: https://tibo.modelyard.dev/sitemap.xml
```

### Sitemap

- HTTP status: `200`
- Content type: `application/xml; charset=utf-8`
- URL count: **44**
- Composition: 2 homepages + 21 English event pages + 21 Chinese event pages
- All current sitemap entries are canonical-looking, absolute production URLs.
- Current sitemap includes all 21 events, including 11 `INDEXED_ONLY` events; an index-eligibility policy does not yet exist.
- The Worker currently queries the latest 100 events for the sitemap (`src/index.ts`).

### Current indexable URL count

**44 by current page robots metadata**: 2 homepages + 42 event-language pages. This is a technical count, not a quality-approved index count. The V2 policy must separate `indexable` from merely `200` and `index, follow`.

## Trust and freshness baseline

- Current event count: **21**.
- Verification status: **10 `DIRECT_VERIFIED`**, **11 `INDEXED_ONLY`**.
- Event pages visibly expose source quality, verification wording, provenance, published time, source excerpt, source account, source URL, and confidence.
- `/api/status` returned `status: ok` but `lastCheckedAt: null`.
- `/api/health` returned `status: ok`, `lastSuccessfulCron: 2026-08-26T17:02:01.013Z`, and `lastSourceFetch: 2026-08-26T17:00:58.336Z`.
- Resulting UI state after hydration: `LIVE` with `Last Checked —`, which is semantically inconsistent.

## Structural baseline

- Homepage has no `<main>`, `<article>`, `<ol>`, or `<li>` for the timeline.
- Homepage has one H1 and one H2; event card titles are `<div>` elements.
- Event pages have an `<article>`, one content H1, and one H3 (`Related Events`), but no H2 section headings; most detail fields are `<div>` pairs.
- Homepage includes `.seo-intro` with `style="display:none"`.
- Homepage displays 21 timeline items but its JSON-LD `ItemList` contains 20 `ListItem` objects.
- Event page descriptions use `description.substring(0, 160)`, which can cut a sentence and leave a trailing space.
- No Article/NewsArticle JSON-LD is present on event pages.

## Search Console status

- `GSC_OWNER_ACTION_REQUIRED`: no Search Console credentials or verified property were available in this task.
- `BING_OWNER_ACTION_REQUIRED`: no Bing Webmaster Tools credentials or verified property were available in this task.
- Public `site:tibo.modelyard.dev` search did not provide a reliable index-status conclusion; URL Inspection remains the source of truth.

## Baseline commands and sources

- Production pages: `https://tibo.modelyard.dev/`, `https://tibo.modelyard.dev/zh/`, `https://tibo.modelyard.dev/events/25`, `https://tibo.modelyard.dev/zh/events/25`
- Technical endpoints: `https://tibo.modelyard.dev/robots.txt`, `https://tibo.modelyard.dev/sitemap.xml`, `https://tibo.modelyard.dev/api/status`, `https://tibo.modelyard.dev/api/health`
- Local implementation inspected: `src/index.ts`, `src/renderer.ts`, `static/app.js`, `src/db/repository.ts`, `tests/e2e/seo.spec.ts`
