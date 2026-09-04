import type { Env } from '../types';
import type { CommunityConfig } from './config';
import type { CommunityEmbedMetadata } from './types';

export interface GitHubRepositoryReference {
  owner: string;
  repo: string;
  originalUrl: string;
  canonicalUrl: string;
}

export interface GitHubRepositoryMetadata {
  owner: string;
  repo: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  metadata: CommunityEmbedMetadata;
  canonicalUrl: string;
}

export type GitHubFetchErrorCode = 'not_found' | 'rate_limited' | 'http_error' | 'invalid_response' | 'timeout' | 'unavailable';

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    readonly code: GitHubFetchErrorCode,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubFetchError';
  }
}

function trimUrlPunctuation(value: string): string {
  let result = value;
  while (/[.,!?;:]$/u.test(result)) result = result.slice(0, -1);
  while (/[\])}]/u.test(result)) result = result.slice(0, -1);
  return result;
}

function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isValidRepositoryPart(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(value);
}

/** Only GitHub repository-root URLs are accepted in V1. */
export function canonicalizeGitHubRepositoryUrl(value: string): GitHubRepositoryReference | null {
  const input = trimUrlPunctuation(value.trim());
  if (!input || /^\s*(?:javascript|data|file|ftp):/iu.test(input)) return null;
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const owner = decodePathPart(parts[0]);
    let repo = decodePathPart(parts[1]);
    if (!owner || !repo) return null;
    if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
    if (!isValidRepositoryPart(owner) || !isValidRepositoryPart(repo)) return null;
    return {
      owner,
      repo,
      originalUrl: input,
      canonicalUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

const GITHUB_URL_PATTERN = /\bhttps?:\/\/(?:www\.)?github\.com\/[^\s<>"'`]+/giu;

export function extractGitHubRepositories(value: string): GitHubRepositoryReference[] {
  const seen = new Set<string>();
  const references: GitHubRepositoryReference[] = [];
  for (const match of value.match(GITHUB_URL_PATTERN) ?? []) {
    const reference = canonicalizeGitHubRepositoryUrl(match);
    if (!reference || seen.has(reference.canonicalUrl)) continue;
    seen.add(reference.canonicalUrl);
    references.push(reference);
  }
  return references;
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeAvatarUrl(value: unknown): string | null {
  const candidate = safeString(value, 500);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'avatars.githubusercontent.com') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function errorCodeForStatus(status: number): GitHubFetchErrorCode {
  if (status === 404) return 'not_found';
  if (status === 403 || status === 429) return 'rate_limited';
  return 'http_error';
}

export async function fetchGitHubRepository(
  reference: GitHubRepositoryReference,
  config: CommunityConfig,
  timeoutMs = 4500,
): Promise<GitHubRepositoryMetadata> {
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Tibo-Community/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
    const response = await fetch(apiUrl, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      throw new GitHubFetchError(`GitHub API returned ${response.status}`, errorCodeForStatus(response.status), response.status);
    }
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      throw new GitHubFetchError('GitHub API returned invalid JSON', 'invalid_response', response.status);
    }

    const apiOwner = payload.owner && typeof payload.owner === 'object'
      ? (payload.owner as Record<string, unknown>)
      : {};
    const owner = safeString(apiOwner.login, 100);
    const repo = safeString(payload.name, 100);
    const htmlUrl = safeString(payload.html_url, 500);
    const apiReference = htmlUrl ? canonicalizeGitHubRepositoryUrl(htmlUrl) : null;
    if (!owner || !repo || owner.toLowerCase() !== reference.owner.toLowerCase()
      || repo.toLowerCase() !== reference.repo.toLowerCase() || !apiReference
      || apiReference.canonicalUrl !== reference.canonicalUrl) {
      throw new GitHubFetchError('GitHub API response did not match repository', 'invalid_response', response.status);
    }

    const licensePayload = payload.license && typeof payload.license === 'object'
      ? payload.license as Record<string, unknown>
      : null;
    const license = safeString(licensePayload?.spdx_id, 100)
      || safeString(licensePayload?.name, 100);
    const metadata: CommunityEmbedMetadata = {
      owner: reference.owner,
      repo: reference.repo,
      stars: safeNonNegativeInteger(payload.stargazers_count),
      forks: safeNonNegativeInteger(payload.forks_count),
      language: safeString(payload.language, 80),
      license,
    };
    return {
      owner: reference.owner,
      repo: reference.repo,
      title: `${reference.owner} / ${reference.repo}`,
      description: safeString(payload.description, 1000),
      imageUrl: safeAvatarUrl(apiOwner.avatar_url),
      metadata,
      canonicalUrl: reference.canonicalUrl,
    };
  } catch (error) {
    if (error instanceof GitHubFetchError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GitHubFetchError('GitHub API request timed out', 'timeout');
    }
    throw new GitHubFetchError('GitHub API request failed', 'unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export function githubMetadataJson(metadata: CommunityEmbedMetadata): string {
  return JSON.stringify(metadata);
}

// Keep Env in this module's public surface so callers can pass the audited
// Worker environment without ever exposing GITHUB_TOKEN to the client.
export type GitHubEnvironment = Pick<Env, 'GITHUB_TOKEN'>;
