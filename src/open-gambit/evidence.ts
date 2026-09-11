import { sha256Hex } from './canonical';
import type { GambitEvidence, GambitSourceDefinition, GambitSourceSnapshot, GambitSourceTier } from './types';

export const GAMBIT_EXTRACTOR_VERSION = 'gambit-html-1';
export const GAMBIT_FEED_EXTRACTOR_VERSION = 'gambit-feed-item-1';

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
  feedItems: ExtractedFeedItem[];
  isFeed: boolean;
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
    // Declared-length pre-check. Two properties make it a fast path rather than
    // the authoritative bound:
    //   1. under an identity encoding `content-length` equals the body length,
    //      so this check and `readBoundedBody` below reject the same responses
    //      and the earlier one simply avoids reading the body;
    //   2. under a compressed encoding the runtime may strip the header, so
    //      `0` (or a compressed length) is observed and the bounded read below
    //      becomes the real enforcement. It is kept because it is the only
    //      cheap rejection available before any body bytes are transferred, and
    //      because the bounded read makes it non-load-bearing -- never treat a
    //      missing or small `content-length` as proof that the body is small.
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
    const feedItems = extracted.feedItems.map(item => ({
      ...item,
      canonicalUrl: resolveSafeUrl(item.canonicalUrl, finalUrl),
    }));
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
      feedItems,
      isFeed: extracted.isFeed === true,
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

export interface ExtractedFeedItem {
  stableId: string;
  title: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  publisher: string | null;
  content: string;
}

export interface ExtractedEvidenceDocument {
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  canonicalUrl: string | null;
  content: string;
  feedItems: ExtractedFeedItem[];
  isFeed: boolean;
}

export function extractEvidenceDocument(raw: string, contentType: string, maxCharacters = 80_000): ExtractedEvidenceDocument {
  const isJson = contentType.includes('json') || raw.trimStart().startsWith('{');
  if (isJson) return extractJsonDocument(raw, maxCharacters);
  if (isXmlContentType(contentType) || looksLikeXmlFeed(raw)) {
    const feed = extractFeedDocument(raw, maxCharacters);
    if (feed) return feed;
  }
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
    feedItems: [],
    isFeed: false,
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
      feedItems: [],
      isFeed: false,
    };
  } catch {
    return { title: null, publisher: null, publishedAt: null, canonicalUrl: null, content: '', feedItems: [], isFeed: false };
  }
}

function isXmlContentType(contentType: string): boolean {
  return contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom');
}

function looksLikeXmlFeed(raw: string): boolean {
  const trimmed = raw.trimStart().toLowerCase();
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed');
}

interface SafeXmlNode {
  name: string;
  attributes: Record<string, string>;
  children: SafeXmlNode[];
  text: string;
}

/**
 * Small, bounded XML tokenizer for feeds. It deliberately accepts no DTD,
 * entity declaration, external entity, or external resource syntax. Feed
 * data is treated as untrusted text and is never turned into a DOM.
 */
function parseSafeXml(raw: string): SafeXmlNode | null {
  const maxNodes = 2_000;
  const maxDepth = 24;
  const maxTextCharacters = 600_000;
  const stack: SafeXmlNode[] = [];
  let root: SafeXmlNode | null = null;
  let position = 0;
  let nodeCount = 0;
  let textCharacters = 0;

  const appendText = (value: string): boolean => {
    if (!value || stack.length === 0) return true;
    textCharacters += value.length;
    if (textCharacters > maxTextCharacters) return false;
    stack[stack.length - 1].text += value;
    return true;
  };

  while (position < raw.length) {
    if (raw[position] !== '<') {
      const nextTag = raw.indexOf('<', position);
      const end = nextTag < 0 ? raw.length : nextTag;
      if (!appendText(raw.slice(position, end))) return null;
      position = end;
      continue;
    }

    if (raw.startsWith('<!--', position)) {
      const end = raw.indexOf('-->', position + 4);
      if (end < 0) return null;
      position = end + 3;
      continue;
    }
    if (raw.startsWith('<![CDATA[', position)) {
      const end = raw.indexOf(']]>', position + 9);
      if (end < 0 || !appendText(raw.slice(position + 9, end))) return null;
      position = end + 3;
      continue;
    }
    if (raw.startsWith('<?', position)) {
      const end = raw.indexOf('?>', position + 2);
      if (end < 0) return null;
      position = end + 2;
      continue;
    }
    // Reject every declaration other than comments, CDATA, and the XML
    // processing instruction handled above. In particular, this rejects
    // DOCTYPE/ENTITY before any XML parser could interpret it.
    if (raw.startsWith('<!', position)) return null;

    const tagEnd = findXmlTagEnd(raw, position + 1);
    if (tagEnd < 0) return null;
    const tag = parseXmlTag(raw.slice(position + 1, tagEnd));
    if (!tag) return null;
    position = tagEnd + 1;

    if (tag.closing) {
      const current = stack.pop();
      if (!current || current.name !== tag.name) return null;
      continue;
    }
    if (nodeCount >= maxNodes || stack.length >= maxDepth) return null;
    nodeCount += 1;
    const node: SafeXmlNode = { name: tag.name, attributes: tag.attributes, children: [], text: '' };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else if (root) return null;
    else root = node;
    if (!tag.selfClosing) stack.push(node);
  }
  return root && stack.length === 0 ? root : null;
}

function findXmlTagEnd(raw: string, start: number): number {
  let quote = '';
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function parseXmlTag(rawTag: string): { name: string; attributes: Record<string, string>; closing: boolean; selfClosing: boolean } | null {
  let value = rawTag.trim();
  if (!value) return null;
  const closing = value.startsWith('/');
  if (closing) {
    value = value.slice(1).trim();
    const name = readXmlName(value, 0);
    return name && value.slice(name.end).trim() === ''
      ? { name: name.value.toLowerCase(), attributes: {}, closing: true, selfClosing: false }
      : null;
  }
  const selfClosing = value.endsWith('/');
  if (selfClosing) value = value.slice(0, -1).trimEnd();
  const name = readXmlName(value, 0);
  if (!name) return null;
  const attributes: Record<string, string> = {};
  let position = name.end;
  while (position < value.length) {
    while (isXmlWhitespace(value[position])) position += 1;
    if (position >= value.length) break;
    const attribute = readXmlName(value, position);
    if (!attribute) return null;
    position = attribute.end;
    while (isXmlWhitespace(value[position])) position += 1;
    if (value[position] !== '=') return null;
    position += 1;
    while (isXmlWhitespace(value[position])) position += 1;
    const quote = value[position];
    if (quote !== '"' && quote !== "'") return null;
    const end = value.indexOf(quote, position + 1);
    if (end < 0) return null;
    attributes[attribute.value.toLowerCase()] = decodeXmlEntities(value.slice(position + 1, end));
    position = end + 1;
  }
  return { name: name.value.toLowerCase(), attributes, closing: false, selfClosing };
}

function readXmlName(value: string, start: number): { value: string; end: number } | null {
  let position = start;
  while (position < value.length && isXmlNameCharacter(value[position], position === start)) position += 1;
  return position > start ? { value: value.slice(start, position), end: position } : null;
}

function isXmlNameCharacter(value: string | undefined, first: boolean): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value === '_') return true;
  if (!first && ((code >= 48 && code <= 57) || value === '.' || value === ':' || value === '-')) return true;
  return (value.codePointAt(0) ?? 0) >= 0x80;
}

function isXmlWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\r' || value === '\n';
}

function extractFeedDocument(raw: string, maxCharacters: number): ExtractedEvidenceDocument | null {
  const root = parseSafeXml(raw);
  if (!root || (root.name !== 'rss' && root.name !== 'feed')) return null;
  const channel = findChild(root, ['channel']);
  const container = channel ?? root;
  const entries = root.name === 'rss'
    ? (channel?.children.filter(child => child.name === 'item') ?? [])
    : root.children.filter(child => child.name === 'entry');
  const title = cleanText(elementText(findChild(container, ['title'])));
  const publisher = cleanText(elementText(findChild(container, ['author', 'dc:creator', 'creator', 'publisher'])))
    || cleanText(elementText(findChild(root, ['author', 'dc:creator', 'creator', 'publisher'])));
  const publishedAt = normalizeDate(elementText(findChild(container, ['pubdate', 'published', 'updated', 'dc:date', 'date'])));
  const canonicalUrl = cleanText(elementText(findChild(container, ['link']))) || root.attributes['xml:base'] || null;
  const feedItems: ExtractedFeedItem[] = entries.slice(0, 200).map(entry => extractFeedItem(entry, root.name === 'rss' ? 'rss' : 'feed')).filter((item): item is ExtractedFeedItem => item !== null);
  const aggregateParts = [title, ...feedItems.map(item => [item.title, item.publishedAt, item.content].filter(Boolean).join('\n'))].filter(Boolean);
  return {
    title,
    publisher,
    publishedAt,
    canonicalUrl,
    content: normalizeVisibleText(aggregateParts.join('\n\n')).slice(0, maxCharacters),
    feedItems,
    isFeed: true,
  };
}

function extractFeedItem(entry: SafeXmlNode, kind: 'rss' | 'feed'): ExtractedFeedItem | null {
  const title = cleanText(elementText(findChild(entry, ['title'])));
  const idValue = cleanText(elementText(findChild(entry, kind === 'rss' ? ['guid', 'id'] : ['id'])));
  const canonicalUrl = kind === 'rss'
    ? cleanText(elementText(findChild(entry, ['link'])))
    : atomAlternateLink(entry);
  const publishedAt = normalizeDate(elementText(findChild(entry, kind === 'rss'
    ? ['pubdate', 'dc:date', 'date', 'published', 'updated']
    : ['published', 'updated', 'pubdate'])));
  const publisher = cleanText(elementText(findChild(entry, kind === 'rss'
    ? ['author', 'dc:creator', 'creator']
    : ['author', 'creator'])));
  const rawContent = elementText(findChild(entry, kind === 'rss'
    ? ['content:encoded', 'content', 'description', 'summary']
    : ['content', 'summary', 'description']));
  const content = normalizeVisibleText(decodeHtmlEntities(stripMarkup(rawContent))).slice(0, 12_000);
  if (!title || !content) return null;
  const stableId = idValue || canonicalUrl || `${title}|${publishedAt ?? ''}`;
  return { stableId: stableId.slice(0, 500), title, canonicalUrl, publishedAt, publisher, content };
}

function atomAlternateLink(entry: SafeXmlNode): string | null {
  const links = entry.children.filter(child => child.name === 'link');
  const alternate = links.find(link => !link.attributes.rel || link.attributes.rel.toLowerCase() === 'alternate');
  return cleanText(alternate?.attributes.href || (alternate ? elementText(alternate) : null));
}

function findChild(node: SafeXmlNode, names: string[]): SafeXmlNode | null {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  return node.children.find(child => wanted.has(child.name) || wanted.has(localXmlName(child.name))) ?? null;
}

function localXmlName(name: string): string {
  const separator = name.indexOf(':');
  return separator >= 0 ? name.slice(separator + 1) : name;
}

function elementText(node: SafeXmlNode | null | undefined): string {
  if (!node) return '';
  const childText = node.children.map(child => elementText(child)).filter(Boolean).join('\n');
  return decodeXmlEntities([node.text, childText].filter(Boolean).join('\n'));
}

function decodeXmlEntities(value: string): string {
  let output = '';
  let position = 0;
  while (position < value.length) {
    const ampersand = value.indexOf('&', position);
    if (ampersand < 0) {
      output += value.slice(position);
      break;
    }
    output += value.slice(position, ampersand);
    const semicolon = value.indexOf(';', ampersand + 1);
    if (semicolon < 0) {
      output += value.slice(ampersand);
      break;
    }
    const entity = value.slice(ampersand + 1, semicolon);
    if (entity === 'amp') output += '&';
    else if (entity === 'lt') output += '<';
    else if (entity === 'gt') output += '>';
    else if (entity === 'quot') output += '"';
    else if (entity === 'apos') output += "'";
    else if (entity.startsWith('#x') || entity.startsWith('#X')) output += safeCodePoint(entity.slice(2), 16);
    else if (entity.startsWith('#')) output += safeCodePoint(entity.slice(1), 10);
    else output += '';
    position = semicolon + 1;
  }
  return output;
}

function safeCodePoint(value: string, radix: number): string {
  const code = Number.parseInt(value, radix);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
  return String.fromCodePoint(code);
}

function resolveSafeUrl(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    return normalizeGambitUrl(new URL(raw, baseUrl).toString());
  } catch {
    return null;
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
