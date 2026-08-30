// ============================================================
// Web-search reset confirmation evidence
// ============================================================
import type { SearchResult } from './providers/types';

export interface CommunityEvidenceCandidate {
  source_url: string;
  source_domain: string;
  source_text: string;
  published_at: string;
}

export interface CommunityEvidenceDecision {
  qualified: boolean;
  independentSources: number;
  domains: number;
  candidates: CommunityEvidenceCandidate[];
}

function hostname(url: string): string | null {
  try {
    const value = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return value || null;
  } catch {
    return null;
  }
}

function canonicalDomain(value: string | null | undefined, fallbackUrl: string): string | null {
  const candidate = value?.trim() || fallbackUrl;
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return hostname(fallbackUrl);
  }
}

function canonicalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_[^=]+|fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return null;
  }
}

function contentFingerprint(result: SearchResult): string | null {
  const text = `${result.title} ${result.snippet}`.replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? text : null;
}

export function isPositiveResetEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const hasResetConcept = /\b(reset|quota|limit|usage|credits?)\b/.test(lower);
  if (!hasResetConcept) return false;

  // Reject negated/unavailable statements before looking for restoration
  // words. Otherwise phrases such as "reset is not happening" match because
  // they contain both the word "reset" and a generic positive token.
  const hasNegativeSignal = [
    /\b(?:no|not|never|without|didn['’]?t|hasn['’]?t|haven['’]?t|isn['’]?t|wasn['’]?t|won['’]?t|cannot|can['’]?t)\b[\s\S]{0,45}\b(?:reset|quota|limit|usage|credits?|access)\b/,
    /\b(?:reset|quota|limit|usage|credits?|access)\b[\s\S]{0,45}\b(?:not|never|unavailable|failed|failing|didn['’]?t|hasn['’]?t|isn['’]?t|wasn['’]?t|won['’]?t)\b/,
  ].some(pattern => pattern.test(lower));
  if (hasNegativeSignal) return false;

  const restorationWords = '(?:back|restored|renewed|available|unlocked|working again|complete|completed|done|successful)';
  const hasPositiveSignal = [
    new RegExp('\\b(?:reset|quota|limit|usage|credits?)\\b[\\s\\S]{0,60}\\b' + restorationWords + '\\b'),
    new RegExp('\\b' + restorationWords + '\\b[\\s\\S]{0,60}\\b(?:reset|quota|limit|usage|credits?)\\b'),
  ].some(pattern => pattern.test(lower));
  return hasPositiveSignal;
}

/**
 * Apply the product rule: three independent URLs, two domains, unambiguous
 * restoration language, and a real publication time after the expected reset.
 * Google indexed timestamps are intentionally not accepted here.
 */
export function evaluateCommunityEvidence(
  results: SearchResult[],
  expectedResetAt: string | null,
): CommunityEvidenceDecision {
  if (!expectedResetAt) return { qualified: false, independentSources: 0, domains: 0, candidates: [] };
  const expected = new Date(expectedResetAt).getTime();
  if (Number.isNaN(expected)) return { qualified: false, independentSources: 0, domains: 0, candidates: [] };

  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const candidates: CommunityEvidenceCandidate[] = [];
  for (const result of results) {
    const domain = canonicalDomain(result.domain, result.url);
    const publishedAt = result.publishedAt;
    if (!domain || !publishedAt || !isPositiveResetEvidence(`${result.title} ${result.snippet}`)) continue;
    const published = new Date(publishedAt).getTime();
    if (Number.isNaN(published) || published <= expected) continue;
    const normalizedUrl = canonicalUrl(result.url);
    const fingerprint = contentFingerprint(result);
    if (!normalizedUrl || seenUrls.has(normalizedUrl) || (fingerprint && seenContent.has(fingerprint))) continue;
    seenUrls.add(normalizedUrl);
    if (fingerprint) seenContent.add(fingerprint);
    candidates.push({
      source_url: normalizedUrl,
      source_domain: domain,
      source_text: `${result.title}\n${result.snippet}`.trim(),
      published_at: new Date(published).toISOString(),
    });
  }
  const domains = new Set(candidates.map(candidate => candidate.source_domain));
  return {
    qualified: candidates.length >= 3 && domains.size >= 2,
    independentSources: candidates.length,
    domains: domains.size,
    candidates,
  };
}
