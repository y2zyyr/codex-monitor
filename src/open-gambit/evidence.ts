import { sha256Hex } from './canonical';
import type { GambitEvidence, GambitSourceDefinition, GambitSourceSnapshot, GambitSourceTier } from './types';

export const GAMBIT_EXTRACTOR_VERSION = 'gambit-html-1';

export type EvidenceFetchStatus =
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_TIMEOUT'
  | 'DYNAMIC_UNSUPPORTED'
  | 'EXTRACTION_FAILED'
  | 'SOURCE_POLICY_REJECTED'
  | 'HTTP_ERROR';

export interface EvidenceFetchFailure {
  ok: false;
  status: EvidenceFetchStatus;
  requestedUrl: string;
  error: string;
}

export interface EvidenceFetchSuccess {
  ok: true;
  snapshot: Omit<GambitSourceSnapshot, 'id' | 'r2Key' | 'retentionUntil' | 'createdAt'>;
}

export type EvidenceFetchResult = EvidenceFetchFailure | EvidenceFetchSuccess;

export interface EvidenceFetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxContentCharacters?: number;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/json',
];

export function normalizeGambitUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    if (url.port === '443') url.port = '';
    const trackingParameters = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'gclid', 'fbclid', 'ref', 'ref_src',
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/u, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === 'metadata.google.internal'
    || host === 'instance-data.ec2.internal'
    || host === 'host.docker.internal'
  ) return true;

  // IPv4 loopback, private, link-local, multicast, and carrier-grade NAT.
  const octets = host.split('.').map(Number);
  if (octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a >= 224);
  }

  // URL.hostname retains the brackets for IPv6 in some runtimes; these
  // checks cover loopback, unspecified, link-local, unique-local, and mapped
  // private IPv4 forms without pretending to perform DNS resolution.
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const mapped = host.match(/^(?:0*:){0,4}ffff:(\d+\.\d+\.\d+\.\d+)$/iu);
  return mapped ? isPrivateOrLocalHostname(mapped[1]) : false;
}

export function isHostnameAllowed(url: string, source: GambitSourceDefinition): boolean {
  const normalized = normalizeGambitUrl(url);
  if (!normalized || !source.enabled) return false;
  try {
    const parsed = new URL(normalized);
    if (isPrivateOrLocalHostname(parsed.hostname)) return false;
    if (parsed.port && parsed.port !== '443') return false;
    const allowed = source.allowedHosts.map(host => host.toLowerCase().replace(/^www\./u, '').replace(/\.$/u, ''));
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '').replace(/\.$/u, '');
    return allowed.some(candidate => host === candidate || host.endsWith(`.${candidate}`));
  } catch {
    return false;
  }
}

export function sourcePolicyFailure(requestedUrl: string, source: GambitSourceDefinition): EvidenceFetchFailure | null {
  if (!isHostnameAllowed(requestedUrl, source)) {
    return {
      ok: false,
      status: 'SOURCE_POLICY_REJECTED',
      requestedUrl,
      error: 'The URL is not HTTPS, is private/local, or is outside the configured source hostname allowlist.',
    };
  }
  return null;
}

export async function fetchEvidence(
  requestedUrl: string,
  source: GambitSourceDefinition,
  options: EvidenceFetchOptions = {},
): Promise<EvidenceFetchResult> {
  const policyError = sourcePolicyFailure(requestedUrl, source);
  if (policyError) return policyError;
  const normalizedRequestedUrl = normalizeGambitUrl(requestedUrl)!;
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = clamp(options.timeoutMs ?? 8_000, 500, 30_000);
  const maxBytes = clamp(options.maxBytes ?? 512_000, 4_096, 2_000_000);
  const maxRedirects = clamp(options.maxRedirects ?? 3, 0, 5);
  let currentUrl = normalizedRequestedUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const redirectPolicyError = sourcePolicyFailure(currentUrl, source);
    if (redirectPolicyError) return redirectPolicyError;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,application/json;q=0.9',
          'User-Agent': 'Tibo-Open-Gambit/1.0 (+https://tibo.modelyard.dev/about/ai)',
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      return {
        ok: false,
        status: isAbort ? 'SOURCE_TIMEOUT' : 'HTTP_ERROR',
        requestedUrl,
        error: isAbort ? `Fetch exceeded ${timeoutMs}ms.` : 'Source request failed.',
      };
    }
    clearTimeout(timeout);

    if (REDIRECT_CODES.has(response.status)) {
      if (redirectCount >= maxRedirects) {
        return { ok: false, status: 'SOURCE_POLICY_REJECTED', requestedUrl, error: 'Redirect limit exceeded.' };
      }
      const location = response.headers.get('location');
      if (!location) return { ok: false, status: 'SOURCE_POLICY_REJECTED', requestedUrl, error: 'Redirect did not provide a location.' };
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, status: 'SOURCE_POLICY_REJECTED', requestedUrl, error: 'Redirect location was invalid.' };
      }
      continue;
    }

    if (!response.ok) {
      return { ok: false, status: 'HTTP_ERROR', requestedUrl, error: `Source returned HTTP ${response.status}.` };
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || '';
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return { ok: false, status: 'DYNAMIC_UNSUPPORTED', requestedUrl, error: `Unsupported content type: ${contentType || 'missing'}.` };
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, status: 'SOURCE_TOO_LARGE', requestedUrl, error: `Response exceeded the ${maxBytes}-byte cap.` };
    }

    let body: string;
    try {
      body = await readBoundedBody(response, maxBytes);
    } catch (error) {
      return {
        ok: false,
        status: error instanceof Error && error.message === 'SOURCE_TOO_LARGE' ? 'SOURCE_TOO_LARGE' : 'EXTRACTION_FAILED',
        requestedUrl,
        error: error instanceof Error ? error.message : 'Response body could not be read.',
      };
    }

    const extracted = extractEvidenceDocument(body, contentType, options.maxContentCharacters ?? 80_000);
    if (!extracted.content.trim()) {
      return { ok: false, status: 'EXTRACTION_FAILED', requestedUrl, error: 'No bounded visible content could be extracted.' };
    }
    const retrievedAt = (options.now ?? new Date()).toISOString();
    const finalUrl = normalizeGambitUrl(currentUrl) ?? normalizedRequestedUrl;
    const canonicalUrl = normalizeGambitUrl(extracted.canonicalUrl || finalUrl) ?? finalUrl;
    const normalizedContent = extracted.content;
    return {
      ok: true,
      snapshot: {
        sourceId: source.id,
        requestedUrl: normalizedRequestedUrl,
        finalUrl,
        canonicalUrl,
        title: extracted.title,
        publisher: extracted.publisher || source.publisher,
        publishedAt: extracted.publishedAt,
        retrievedAt,
        normalizedContent,
        contentHash: await sha256Hex(normalizedContent),
        extractorVersion: GAMBIT_EXTRACTOR_VERSION,
        sourceQualityTier: source.qualityTier,
      },
    };
  }

  return { ok: false, status: 'SOURCE_POLICY_REJECTED', requestedUrl, error: 'Redirect policy rejected the request.' };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('SOURCE_TOO_LARGE');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel('SOURCE_TOO_LARGE');
        throw new Error('SOURCE_TOO_LARGE');
      }
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

interface ExtractedEvidenceDocument {
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  canonicalUrl: string | null;
  content: string;
}

export function extractEvidenceDocument(raw: string, contentType: string, maxCharacters = 80_000): ExtractedEvidenceDocument {
  const isJson = contentType.includes('json') || raw.trimStart().startsWith('{');
  if (isJson) return extractJsonDocument(raw, maxCharacters);
  const title = firstMatch(raw, /<title[^>]*>([\s\S]*?)<\/title>/iu);
  const ogTitle = firstMeta(raw, 'og:title');
  const publisher = firstMeta(raw, 'og:site_name') || firstMeta(raw, 'author') || firstMeta(raw, 'article:author');
  const publishedValue = firstMeta(raw, 'article:published_time') || firstMeta(raw, 'date');
  const canonical = firstMatch(raw, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/iu)
    || firstMatch(raw, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/iu);
  const jsonLd = extractJsonLd(raw);
  const visible = stripMarkup(raw);
  const content = normalizeVisibleText(decodeHtmlEntities(visible)).slice(0, maxCharacters);
  return {
    title: cleanText(ogTitle || jsonLd.title || title),
    publisher: cleanText(publisher || jsonLd.publisher),
    publishedAt: normalizeDate(publishedValue || jsonLd.publishedAt),
    canonicalUrl: canonical ? decodeHtmlEntities(canonical).trim() : null,
    content,
  };
}

function extractJsonDocument(raw: string, maxCharacters: number): ExtractedEvidenceDocument {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const title = typeof value.title === 'string' ? value.title : typeof value.name === 'string' ? value.name : null;
    const content = typeof value.content === 'string'
      ? value.content
      : typeof value.body === 'string' ? value.body : JSON.stringify(value);
    const publisher = typeof value.publisher === 'string' ? value.publisher : null;
    const publishedAt = typeof value.published_at === 'string'
      ? value.published_at
      : typeof value.publishedAt === 'string' ? value.publishedAt : null;
    const url = typeof value.url === 'string' ? value.url : null;
    return {
      title: cleanText(title),
      publisher: cleanText(publisher),
      publishedAt: normalizeDate(publishedAt),
      canonicalUrl: url,
      content: normalizeVisibleText(decodeHtmlEntities(stripMarkup(content))).slice(0, maxCharacters),
    };
  } catch {
    return { title: null, publisher: null, publishedAt: null, canonicalUrl: null, content: '' };
  }
}

function stripMarkup(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<([a-z0-9]+)\b[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*display\s*:\s*none)[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/giu, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ');
}

function extractJsonLd(raw: string): { title: string | null; publisher: string | null; publishedAt: string | null } {
  const scripts = [...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)];
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1]) as Record<string, unknown> | Array<Record<string, unknown>>;
      const records = Array.isArray(value) ? value : [value];
      for (const record of records) {
        if (typeof record.headline === 'string' || typeof record.name === 'string') {
          const author = typeof record.publisher === 'object' && record.publisher
            ? (record.publisher as Record<string, unknown>).name
            : record.publisher;
          return {
            title: typeof record.headline === 'string' ? record.headline : typeof record.name === 'string' ? record.name : null,
            publisher: typeof author === 'string' ? author : null,
            publishedAt: typeof record.datePublished === 'string' ? record.datePublished : null,
          };
        }
      }
    } catch {
      // JSON-LD is optional metadata; visible extraction remains authoritative.
    }
  }
  return { title: null, publisher: null, publishedAt: null };
}

function firstMeta(raw: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return firstMatch(raw, new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'iu'))
    || firstMatch(raw, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'iu'));
}

function firstMatch(raw: string, pattern: RegExp): string | null {
  return raw.match(pattern)?.[1] ?? null;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value ? normalizeVisibleText(decodeHtmlEntities(value)) : '';
  return cleaned || null;
}

function normalizeVisibleText(value: string): string {
  return value
    .replace(/\u0000/gu, ' ')
    .replace(/[ \t\r\f]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#(\d+);/gu, (_match, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(0x10ffff, code)) : '';
    });
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function evidenceForModel(evidence: GambitEvidence[], snapshots: GambitSourceSnapshot[]): string {
  const snapshotById = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
  return evidence.map(item => {
    const snapshot = snapshotById.get(item.snapshotId);
    return [
      `[BEGIN_UNTRUSTED_EVIDENCE id=${item.id ?? 'pending'} source=${item.sourceId} tier=${item.sourceTier}]`,
      `Title: ${snapshot?.title ?? item.title ?? ''}`,
      `URL: ${item.canonicalUrl}`,
      `Published: ${item.publishedAt ?? ''}`,
      `Quoted content: ${item.quote.slice(0, 12_000)}`,
      '[END_UNTRUSTED_EVIDENCE]',
    ].join('\n');
  }).join('\n\n');
}

export function sourceTierSupportsClaim(tier: GambitSourceTier): boolean {
  return tier !== 'DISCOVERY_ONLY';
}
