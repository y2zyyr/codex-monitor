import type { CommunityTopic } from './topics';
import type { SiteLocale } from '../i18n';

export type CommunityPostStatus = 'approved' | 'pending' | 'hidden' | 'deleted';
export type TranslationStatus = 'pending' | 'translated' | 'partial' | 'failed';
export type CommunityEmbedStatus = 'pending' | 'success' | 'failed';
export type CommunityAuthorRole = 'member' | 'admin';
/**
 * Server-assigned provenance of a Community post. Never set by a public client:
 * the anonymous endpoint always stores `human`, the authenticated admin endpoint
 * stores `admin`, and the internal agent endpoint stores `agent`.
 */
export type CommunityAuthorType = 'human' | 'agent' | 'admin';
export type CommunityTranslations = Partial<Record<SiteLocale, string>>;

export interface CommunityEmbedMetadata {
  owner: string;
  repo: string;
  stars: number | null;
  forks: number | null;
  language: string | null;
  license: string | null;
}

export interface CommunityEmbed {
  id: number;
  postId: number;
  type: 'repository';
  provider: 'github';
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  metadata: CommunityEmbedMetadata | null;
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fetchStatus: CommunityEmbedStatus;
  lastError: string | null;
  retryCount: number;
}

export interface CommunityPost {
  id: number;
  nickname: string;
  authorRole: CommunityAuthorRole;
  isAnnouncement: boolean;
  originalContent: string;
  originalLanguage: string;
  contentEn: string | null;
  contentZh: string | null;
  /** Normalized write-once/read-many translations. Legacy en/zh columns remain for compatibility. */
  translations?: CommunityTranslations;
  translationStatus: TranslationStatus;
  translationProvider: string | null;
  translatedAt: string | null;
  status: CommunityPostStatus;
  createdAt: string;
  updatedAt: string;
  sourceHash: string;
  contentHash: string;
  moderationReason: string | null;
  topic: CommunityTopic;
  isPinned: boolean;
  isFeatured: boolean;
  /** Server-assigned provenance. Optional for backward compatibility with legacy rows. */
  authorType?: CommunityAuthorType;
  /** Public agent id (e.g. `skill-hunter`) when authorType is `agent`, else null. */
  agentId?: string | null;
  embeds: CommunityEmbed[];
}

export interface PublicCommunityPost {
  id: number;
  nickname: string;
  authorRole: CommunityAuthorRole;
  isAnnouncement: boolean;
  originalContent: string;
  originalLanguage: string;
  contentEn: string | null;
  contentZh: string | null;
  translations?: CommunityTranslations;
  translationStatus: TranslationStatus;
  translatedAt: string | null;
  status: CommunityPostStatus;
  createdAt: string;
  updatedAt: string;
  topic: CommunityTopic;
  isPinned: boolean;
  isFeatured: boolean;
  authorType?: CommunityAuthorType;
  agentId?: string | null;
  embeds: CommunityEmbed[];
}

export interface AdminCommunityPost extends CommunityPost {}

export interface CommunityPageData {
  posts: PublicCommunityPost[];
  nextCursor: string | null;
  total: number;
  postingEnabled: boolean;
  turnstileSiteKey: string | null;
  maxNicknameLength: number;
  maxContentLength: number;
  filters?: CommunityPostFilters;
  feedError?: boolean;
}

export interface CommunityPostFilters {
  query: string | null;
  topic: CommunityTopic | null;
  featuredOnly: boolean;
  githubOnly: boolean;
}

export interface CommunityStats {
  total: number;
  pinned: number;
  featured: number;
  translationFailed: number;
  embedFailed: number;
  byStatus: Record<CommunityPostStatus, number>;
  byTopic: Record<CommunityTopic, number>;
}

export interface CommunityListResult<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}
