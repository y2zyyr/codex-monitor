// ============================================================
// Codex Usage Monitor - Social Source Provider Interface
// ============================================================
import type { SourcePost } from '../types';

export type SearchPurpose = 'discovery' | 'confirmation';

export interface SearchQuery {
  q: string;
  purpose: SearchPurpose;
  account?: string;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  indexedAt?: string | null;
  publishedAt?: string | null;
  domain?: string;
  raw?: unknown;
}

/**
 * WebSearchProvider is intentionally separate from SocialSourceProvider.
 * Search results are indexed evidence and must not be represented as direct
 * timeline data until an authoritative social provider verifies them.
 */
export interface WebSearchProvider {
  readonly name: string;
  search(query: SearchQuery, now?: Date): Promise<SearchResult[]>;
}

/**
 * SocialSourceProvider
 * 
 * Abstract interface for fetching posts from social media sources.
 * Implementations must replace this for different data sources.
 * 
 * Current implementations:
 * - XApiProvider: Twitter API v2 (requires X_API_BEARER_TOKEN)
 * - NullProvider: Returns empty array (for testing / pre-config)
 */
export interface SocialSourceProvider {
  readonly name: string;
  fetchLatestPosts(): Promise<SourcePost[]>;
}

/**
 * NullProvider - Returns empty posts.
 * Used when no API key is configured, so the system still runs
 * without crashing.
 */
export class NullProvider implements SocialSourceProvider {
  readonly name = 'null';
  async fetchLatestPosts(): Promise<SourcePost[]> {
    return [];
  }
}
