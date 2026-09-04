import type { Env } from '../types';
import type { CommunityConfig } from './config';
import { communityAgentReservationKeys } from './identity';
import { isCommunityTopic, type CommunityTopic } from './topics';

const RESERVED_NICKNAME_KEYS = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'staff',
  'official',
  'support',
  'system',
  'team',
  'tibo',
  'tibomonitor',
  'modelyard',
  'modelyardcommunity',
  'communityadmin',
  'verified',
  // First-party automation identities are server-issued only.
  ...communityAgentReservationKeys(),
]);

function nicknameReservationKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{Cf}\p{Z}\p{P}\p{S}]/gu, '');
}

export function isReservedCommunityNickname(value: string): boolean {
  const key = nicknameReservationKey(value);
  if (!key) return false;
  if (RESERVED_NICKNAME_KEYS.has(key)) return true;
  return /^(?:admin|administrator|moderator|official|staff|support|system|team)\d*$/u.test(key);
}

export interface CommunityInput {
  nickname: string;
  content: string;
  topic: CommunityTopic;
}

export type CommunityValidationResult =
  | { ok: true; value: CommunityInput }
  | { ok: false; error: string; code?: 'INVALID_INPUT' | 'RESERVED_NICKNAME' };

export interface CommunityValidationOptions {
  allowReservedNickname?: boolean;
}

export interface SpamAssessment {
  pending: boolean;
  reasons: string[];
}

export interface TurnstileVerification {
  success: boolean;
  errorCodes: string[];
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function normalizedNfc(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n');
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeCommunityNickname(value: string): string {
  return normalizedNfc(value).trim().replace(/[ \t]+/g, ' ');
}

export function normalizeCommunityContent(value: string): string {
  return normalizedNfc(value)
    .trim()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

export function validateCommunityInput(
  input: unknown,
  config: CommunityConfig,
  options: CommunityValidationOptions = {},
): CommunityValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Please enter a nickname and message.' };
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.nickname !== 'string' || typeof candidate.content !== 'string') {
    return { ok: false, error: 'Please enter a nickname and message.' };
  }

  const nickname = normalizeCommunityNickname(candidate.nickname);
  const content = normalizedNfc(candidate.content).trim();
  if (!nickname) return { ok: false, error: 'Nickname is required.' };
  if (!content) return { ok: false, error: 'Message is required.' };
  if (unicodeLength(nickname) > config.maxNicknameLength) {
    return { ok: false, error: `Nickname must be ${config.maxNicknameLength} characters or fewer.` };
  }
  if (!options.allowReservedNickname && isReservedCommunityNickname(nickname)) {
    return { ok: false, code: 'RESERVED_NICKNAME', error: 'This nickname is reserved for official accounts.' };
  }
  if (unicodeLength(content) > config.maxContentLength) {
    return { ok: false, error: `Message must be ${config.maxContentLength} characters or fewer.` };
  }
  const topic = candidate.topic === undefined || candidate.topic === null || candidate.topic === ''
    ? 'general'
    : typeof candidate.topic === 'string' ? candidate.topic.trim().toLowerCase() : '';
  if (!isCommunityTopic(topic)) return { ok: false, error: 'Please choose a valid topic.' };
  // Nicknames are displayed as text, but rejecting controls keeps logs,
  // moderation screens, and accessibility labels unambiguous.
  if (/[\u0000-\u001f\u007f]/u.test(nickname)) {
    return { ok: false, error: 'Nickname contains unsupported control characters.' };
  }
  if (/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
    return { ok: false, error: 'Message contains unsupported control characters.' };
  }
  return { ok: true, value: { nickname, content, topic } };
}

function countMatches(value: string, expression: RegExp): number {
  return value.match(expression)?.length ?? 0;
}

export function assessSpam(content: string): SpamAssessment {
  const reasons: string[] = [];
  const urlCount = countMatches(content, /https?:\/\/[^\s<>"'`]+/giu);
  if (urlCount > 3) reasons.push('too_many_urls');

  if (/(.)\1{7,}/su.test(content)) reasons.push('repeated_characters');

  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const lineCounts = new Map<string, number>();
  for (const line of lines) lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
  if ([...lineCounts.values()].some(count => count >= 3)) reasons.push('repeated_lines');

  const compact = Array.from(content.replace(/\s/gu, ''));
  const uniqueCharacters = new Set(compact).size;
  if (compact.length >= 24 && uniqueCharacters <= 4) reasons.push('low_entropy');

  if (countMatches(content, /@[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}/gu) > 5) reasons.push('too_many_mentions');

  if (/(?:free\s+crypto|buy\s+followers|casino\s+bonus|work\s+from\s+home\s+and\s+earn|claim\s+your\s+prize)/iu.test(content)) {
    reasons.push('known_spam_pattern');
  }

  return { pending: reasons.length > 0, reasons };
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Only Cloudflare's platform-managed connecting-IP header is trusted. */
export function requestSourceAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
}

export async function deriveSourceHash(request: Request, secret: string): Promise<string> {
  return hmacSha256Hex(secret, requestSourceAddress(request));
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  timeoutMs = 4000,
): Promise<TurnstileVerification> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({ secret, response: token });
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    let payload: { success?: boolean; ['error-codes']?: unknown } = {};
    try {
      payload = await response.json() as typeof payload;
    } catch {
      payload = {};
    }
    const codes = Array.isArray(payload['error-codes'])
      ? payload['error-codes'].filter((code): code is string => typeof code === 'string').slice(0, 5)
      : [];
    return { success: response.ok && payload.success === true, errorCodes: codes };
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'unavailable';
    return { success: false, errorCodes: [code] };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Browser-origin requests must originate from this site. Requests without an
 * Origin header (normal same-origin navigations and server-side clients) are
 * still protected by Turnstile and the source hash.
 */
export function isAllowedCommunityOrigin(request: Request, siteUrl: string): boolean {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const configuredOrigin = new URL(siteUrl).origin;
    return originUrl.origin === configuredOrigin;
  } catch {
    return false;
  }
}

export function isValidSourceHash(value: string): boolean {
  return /^[a-f0-9]{64}$/iu.test(value);
}

export function isValidAdminExpiry(value: unknown, now = new Date()): value is string | null {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > now.getTime();
}

/**
 * Authenticate the small operator surface without putting credentials in a
 * URL or browser storage. The configured token is compared via fixed-size
 * SHA-256 digests so the raw secret never enters logs or API responses.
 */
export async function isCommunityAdminRequest(request: Request, expectedToken: string | null): Promise<boolean> {
  const expected = expectedToken?.trim() || '';
  if (!expected) return false;
  const authorization = request.headers.get('Authorization')?.trim() || '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : request.headers.get('X-Community-Admin-Token')?.trim() || '';
  if (!supplied) return false;

  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/**
 * Authenticate a first-party Community agent. The configured secret is compared
 * via fixed-size SHA-256 digests so the raw value never enters logs or API
 * responses. Agents authenticate with `Authorization: Bearer <secret>` or the
 * `X-Community-Agent-Secret` header; both are treated identically.
 *
 * Returns false when the secret is unset (agent posting disabled) or missing.
 */
export async function isCommunityAgentRequest(request: Request, expectedSecret: string | null): Promise<boolean> {
  const expected = expectedSecret?.trim() || '';
  if (!expected) return false;
  const authorization = request.headers.get('Authorization')?.trim() || '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : request.headers.get('X-Community-Agent-Secret')?.trim() || '';
  if (!supplied) return false;

  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
