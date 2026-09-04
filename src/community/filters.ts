import type { CommunityPostFilters } from './types';
import { isCommunityTopic } from './topics';

export const EMPTY_COMMUNITY_FILTERS: CommunityPostFilters = {
  query: null,
  topic: null,
  featuredOnly: false,
  githubOnly: false,
};

function readBoolean(value: string | null): boolean {
  return value === '1' || value === 'true';
}

export function readCommunityFilters(url: URL): { filters: CommunityPostFilters; invalidTopic: boolean } {
  const rawQuery = (url.searchParams.get('q') || '').normalize('NFC').trim();
  const rawTopic = (url.searchParams.get('topic') || '').trim().toLowerCase();
  const topic = rawTopic && rawTopic !== 'all' ? rawTopic : null;
  return {
    filters: {
      query: rawQuery ? Array.from(rawQuery).slice(0, 80).join('') : null,
      topic: topic && isCommunityTopic(topic) ? topic : null,
      featuredOnly: readBoolean(url.searchParams.get('featured')),
      githubOnly: readBoolean(url.searchParams.get('github')),
    },
    invalidTopic: Boolean(topic && !isCommunityTopic(topic)),
  };
}

export function communityFiltersQuery(filters: CommunityPostFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.featuredOnly) params.set('featured', '1');
  if (filters.githubOnly) params.set('github', '1');
  return params.toString();
}
