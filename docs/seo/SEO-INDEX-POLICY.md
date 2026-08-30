# SEO Index Eligibility Policy

**Status:** Implemented by `src/utils/index-policy.ts`
**Date:** 2026-08-27

## Principle

Verification quality and index eligibility are different decisions:

```text
verification quality
 + content depth
 + unique information
 + provenance
 + historical context
 = index eligibility
```

The policy is intentionally conservative. A verified event can still be too incomplete to index, and an indexed-only event can qualify only when its visible evidence and historical value make it useful. No status is used as a keyword or URL-volume shortcut.

## Event policy

An event must have all of the following core properties:

- a published date or record date;
- a positive `source_post_id`;
- a non-empty `source_url`;
- a non-empty `first_discovered_via`;
- a meaningful English title and Chinese title;
- a meaningful English summary (at least 80 trimmed characters) and Chinese summary (at least 20 trimmed characters).

The length checks are internal completeness guards against empty classifier output. They are not keyword-density targets and do not imply that Google uses these thresholds.

| Verification state | Core record complete | Source excerpt | Result |
|---|---:|---:|---|
| `DIRECT_VERIFIED` | Yes | Not required beyond the source link | `index, follow` candidate |
| `OFFICIAL_VERIFIED` | Yes | Not required beyond the source link | `index, follow` candidate |
| `INDEXED_ONLY` | Yes | At least 80 trimmed characters | `index, follow` candidate, while visibly marked indexed-only |
| `INDEXED_ONLY` | No or excerpt too short | Any | `noindex, follow` |
| `PENDING`, unknown, or missing | Any | Any | `noindex, follow` |
| `REJECTED` | Any | Any | Not returned as an event page; never in sitemap |

An index candidate is still subject to review for duplicate or superseded content. The current application does not invent superseding relationships, so it only applies the automatic completeness/provenance gate. If a reliable relationship is added later, a superseded record should remain indexable only when it has distinct historical information; otherwise use a deliberate redirect or canonical decision based on the actual replacement page.

## Page-level rules

### Core landing pages

- `/faq/` and `/methodology/` (and their Chinese equivalents) are indexable because their own visible content is substantive and not dependent on a fabricated event.
- `/latest/` is indexable only when the five records it renders contain at least one eligible event.
- `/reset-history/` is indexable only when its reset-category dataset contains at least one eligible event.
- `/rate-limit-updates/` is indexable only when its explicit taxonomy dataset contains at least one eligible event.
- A dynamic landing page with no eligible event is `noindex, follow`, but remains navigable so future real data can populate it.

### 404 and APIs

- Unknown and missing routes return HTTP `404`, `noindex, nofollow`, and no canonical link.
- `/api/*` remains JSON and sends `X-Robots-Tag: noindex, nofollow`, including HEAD responses.
- Redirect variants are not index candidates and are not added to the sitemap.

## Sitemap policy

`/sitemap.xml` contains only:

- canonical `https://tibo.modelyard.dev` URLs;
- pages with HTTP 200 behavior;
- pages that pass the relevant index-eligibility rule;
- both reciprocal language variants for a page pair.

It excludes APIs, 404s, redirects, preview/local hosts, rejected events, thin event pages, and dynamic pages that are currently `noindex`.

The homepage is always a canonical index candidate. Event URLs remain `/events/:id` and `/zh/events/:id`; no slug migration is part of this phase.

## Evidence language requirements

Visible pages must preserve the distinction:

- `DIRECT` / direct source is not the same as official policy confirmation;
- `OFFICIAL` is a source taxonomy label, not a blanket claim about every product rule;
- `INDEXED_ONLY` means search-index evidence was found, not direct verification;
- missing dates are `Unknown` / `未知`;
- missing verification is `Pending verification` / `待验证` or `Not independently verified` / `未独立验证` as applicable.

Summaries labelled AI are summaries, not independent evidence. The source link and visible source excerpt are the review path.

## Regression invariants

The automated checks must keep these invariants true:

1. Every 200 indexable page has a self canonical.
2. A 404 never canonicalizes to the homepage.
3. No `noindex` page appears in the sitemap.
4. An API response remains noindex.
5. SSR and hydrated homepage metadata have the same semantic values.
6. English and Chinese hreflang links are reciprocal and point to existing route shapes.
7. JSON-LD parses and ItemList length matches the visible event list.
8. Article fields are supported by visible event content or visible source context.
9. Preview/local hostnames never become canonical or sitemap hosts.
