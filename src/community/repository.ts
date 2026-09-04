import type { D1Database } from '@cloudflare/workers-types';
import type {
  AdminCommunityPost,
  CommunityAuthorType,
  CommunityEmbed,
  CommunityEmbedMetadata,
  CommunityListResult,
  CommunityPost,
  CommunityPostFilters,
  CommunityPostStatus,
  CommunityStats,
  CommunityTranslations,
  PublicCommunityPost,
  TranslationStatus,
} from './types';
import { COMMUNITY_TOPICS, isCommunityTopic, type CommunityTopic } from './topics';
import type { SiteLocale } from '../i18n';

interface CommunityPostRow {
  id: number;
  nickname: string;
  original_content: string;
  original_language: string;
  content_en: string | null;
  content_zh: string | null;
  translation_status: string;
  translation_provider: string | null;
  translated_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  source_hash: string;
  content_hash: string;
  moderation_reason: string | null;
  topic?: string;
  author_role?: string;
  author_type?: string;
  agent_id?: string | null;
  is_announcement?: number;
  is_pinned?: number;
  is_featured?: number;
}

interface CommunityEmbedRow {
  id: number;
  post_id: number;
  type: string;
  provider: string;
  url: string;
  canonical_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  metadata_json: string | null;
  fetched_at: string | null;
  created_at: string;
  updated_at: string;
  fetch_status: string;
  last_error: string | null;
  retry_count: number;
}

interface CommunityRateLimitRow {
  source_hash: string;
  minute_started_ms: number;
  minute_count: number;
  hour_started_ms: number;
  hour_count: number;
  day_started_ms: number;
  day_count: number;
  updated_at: string;
}

interface CommunityTranslationRow {
  post_id: number;
  language: string;
  content: string;
  status: string;
}

interface DuplicateRow {
  id: number;
  status: string;
}

export interface CommunityPostInsert {
  nickname: string;
  originalContent: string;
  topic: CommunityTopic;
  authorRole?: 'member' | 'admin';
  /** Server-assigned provenance. Derived from authorRole when omitted. */
  authorType?: CommunityAuthorType;
  /** Public agent id when authorType is `agent`, else null. Never the secret. */
  agentId?: string | null;
  isAnnouncement?: boolean;
  isPinned?: boolean;
  isFeatured?: boolean;
  sourceHash: string;
  contentHash: string;
  status: CommunityPostStatus;
  moderationReason: string | null;
  createdAt: string;
}

export interface TranslationUpdate {
  originalLanguage: string;
  contentEn: string | null;
  contentZh: string | null;
  translationStatus: TranslationStatus;
  translationProvider: string | null;
  translatedAt: string | null;
  updatedAt: string;
  translations?: CommunityTranslations;
}

export interface EmbedUpsert {
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
  fetchStatus: 'pending' | 'success' | 'failed';
  lastError: string | null;
  retryCount?: number;
  updatedAt: string;
}

export interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perDay: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  blockedWindow: 'minute' | 'hour' | 'day' | null;
  retryAfterSeconds: number;
}

export interface CommunityBan {
  id: number;
  sourceHash: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

function mapTranslationStatus(value: string): TranslationStatus {
  return value === 'translated' || value === 'partial' || value === 'failed' ? value : 'pending';
}

function mapPostStatus(value: string): CommunityPostStatus {
  return value === 'pending' || value === 'hidden' || value === 'deleted' ? value : 'approved';
}

function mapEmbedStatus(value: string): CommunityEmbed['fetchStatus'] {
  return value === 'success' || value === 'failed' ? value : 'pending';
}

function parseEmbedMetadata(value: string | null): CommunityEmbedMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CommunityEmbedMetadata>;
    if (typeof parsed.owner !== 'string' || typeof parsed.repo !== 'string') return null;
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      stars: typeof parsed.stars === 'number' ? parsed.stars : null,
      forks: typeof parsed.forks === 'number' ? parsed.forks : null,
      language: typeof parsed.language === 'string' ? parsed.language : null,
      license: typeof parsed.license === 'string' ? parsed.license : null,
    };
  } catch {
    return null;
  }
}

function mapEmbed(row: CommunityEmbedRow): CommunityEmbed {
  return {
    id: row.id,
    postId: row.post_id,
    type: 'repository',
    provider: 'github',
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    metadata: parseEmbedMetadata(row.metadata_json),
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fetchStatus: mapEmbedStatus(row.fetch_status),
    lastError: row.last_error,
    retryCount: row.retry_count ?? 0,
  };
}

function mapPost(row: CommunityPostRow, embeds: CommunityEmbed[], storedTranslations: CommunityTranslations = {}): CommunityPost {
  const topic = isCommunityTopic(row.topic) ? row.topic : 'general';
  const translations: CommunityTranslations = { ...storedTranslations };
  if (row.content_en && !translations.en) translations.en = row.content_en;
  if (row.content_zh && !translations.zh) translations.zh = row.content_zh;
  const authorType: CommunityAuthorType = (row.author_type as CommunityAuthorType)
    || (row.author_role === 'admin' ? 'admin' : 'human');
  return {
    id: row.id,
    nickname: row.nickname,
    authorRole: row.author_role === 'admin' ? 'admin' : 'member',
    isAnnouncement: row.is_announcement === 1,
    originalContent: row.original_content,
    originalLanguage: row.original_language || 'und',
    contentEn: row.content_en,
    contentZh: row.content_zh,
    translations,
    translationStatus: mapTranslationStatus(row.translation_status),
    translationProvider: row.translation_provider,
    translatedAt: row.translated_at,
    status: mapPostStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceHash: row.source_hash,
    contentHash: row.content_hash,
    moderationReason: row.moderation_reason,
    topic,
    isPinned: row.is_pinned === 1,
    isFeatured: row.is_featured === 1,
    authorType,
    agentId: row.agent_id ?? null,
    embeds,
  };
}

export function toPublicCommunityPost(post: CommunityPost): PublicCommunityPost {
  return {
    id: post.id,
    nickname: post.nickname,
    authorRole: post.authorRole,
    isAnnouncement: post.isAnnouncement,
    originalContent: post.originalContent,
    originalLanguage: post.originalLanguage,
    contentEn: post.contentEn,
    contentZh: post.contentZh,
    translations: post.translations,
    translationStatus: post.translationStatus,
    translatedAt: post.translatedAt,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    topic: post.topic,
    isPinned: post.isPinned,
    isFeatured: post.isFeatured,
    authorType: post.authorType ?? 'human',
    agentId: post.agentId ?? null,
    embeds: post.embeds.filter(embed => embed.fetchStatus === 'success'),
  };
}

export function toAdminCommunityPost(post: CommunityPost): AdminCommunityPost {
  return post;
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return atob(normalized);
  } catch {
    return null;
  }
}

function isValidCursorDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

export class CommunityRepository {
  constructor(private readonly db: D1Database) {}

  static encodeCursor(createdAt: string, id: number, isPinned = false, isFeatured = false): string {
    const value = btoa(JSON.stringify({ createdAt, id, isPinned: isPinned ? 1 : 0, isFeatured: isFeatured ? 1 : 0 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return value;
  }

  static decodeCursor(cursor: string | null | undefined): { createdAt: string; id: number; isPinned: number; isFeatured: number } | null {
    if (!cursor || cursor.length > 200) return null;
    const decoded = decodeBase64Url(cursor);
    if (!decoded) return null;
    try {
      const value = JSON.parse(decoded) as { createdAt?: unknown; id?: unknown; isPinned?: unknown; isFeatured?: unknown };
      if (!isValidCursorDate(value.createdAt) || !Number.isInteger(value.id) || (value.id as number) <= 0) return null;
      const isPinned = value.isPinned === undefined ? 0 : value.isPinned;
      const isFeatured = value.isFeatured === undefined ? 0 : value.isFeatured;
      if (![0, 1].includes(isPinned as number) || ![0, 1].includes(isFeatured as number)) return null;
      return { createdAt: value.createdAt, id: value.id as number, isPinned: isPinned as number, isFeatured: isFeatured as number };
    } catch {
      return null;
    }
  }

  private async embedsForPosts(postIds: number[], includeFailures = false): Promise<Map<number, CommunityEmbed[]>> {
    const grouped = new Map<number, CommunityEmbed[]>();
    if (postIds.length === 0) return grouped;
    const placeholders = postIds.map(() => '?').join(',');
    const statusClause = includeFailures ? '' : " AND fetch_status = 'success'";
    const { results } = await this.db.prepare(
      `SELECT * FROM community_embeds WHERE post_id IN (${placeholders})${statusClause} ORDER BY id ASC`,
    ).bind(...postIds).all<CommunityEmbedRow>();
    for (const row of results) {
      const list = grouped.get(row.post_id) ?? [];
      list.push(mapEmbed(row));
      grouped.set(row.post_id, list);
    }
    return grouped;
  }

  private async translationsForPosts(postIds: number[]): Promise<Map<number, CommunityTranslations>> {
    const grouped = new Map<number, CommunityTranslations>();
    if (postIds.length === 0) return grouped;
    const placeholders = postIds.map(() => '?').join(',');
    const { results } = await this.db.prepare(
      `SELECT post_id, language, content, status FROM community_post_translations WHERE post_id IN (${placeholders}) AND status = 'translated' ORDER BY post_id ASC, id ASC`,
    ).bind(...postIds).all<CommunityTranslationRow>();
    for (const row of results) {
      if (!row.content || !['en', 'zh', 'ja', 'es', 'fr'].includes(row.language)) continue;
      const translations = grouped.get(row.post_id) ?? {};
      translations[row.language as SiteLocale] = row.content;
      grouped.set(row.post_id, translations);
    }
    return grouped;
  }

  private async listPosts(
    where: string,
    whereParams: unknown[],
    limit: number,
    cursor: { createdAt: string; id: number; isPinned?: number; isFeatured?: number } | null,
  ): Promise<CommunityListResult<CommunityPost>> {
    const cursorClause = cursor
      ? ' AND (is_pinned < ? OR (is_pinned = ? AND is_featured < ?) OR (is_pinned = ? AND is_featured = ? AND created_at < ?) OR (is_pinned = ? AND is_featured = ? AND created_at = ? AND id < ?))'
      : '';
    const cursorParams = cursor ? [
      cursor.isPinned ?? 0,
      cursor.isPinned ?? 0,
      cursor.isFeatured ?? 0,
      cursor.isPinned ?? 0,
      cursor.isFeatured ?? 0,
      cursor.createdAt,
      cursor.isPinned ?? 0,
      cursor.isFeatured ?? 0,
      cursor.createdAt,
      cursor.id,
    ] : [];
    const query = `SELECT * FROM community_posts WHERE ${where}${cursorClause} ORDER BY is_pinned DESC, is_featured DESC, created_at DESC, id DESC LIMIT ?`;
    const { results } = await this.db.prepare(query)
      .bind(...whereParams, ...cursorParams, limit + 1)
      .all<CommunityPostRow>();
    const hasMore = results.length > limit;
    const rows = results.slice(0, limit);
    const [embeds, translations] = await Promise.all([
      this.embedsForPosts(rows.map(row => row.id)),
      this.translationsForPosts(rows.map(row => row.id)),
    ]);
    const data = rows.map(row => mapPost(row, embeds.get(row.id) ?? [], translations.get(row.id) ?? {}));
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? CommunityRepository.encodeCursor(last.createdAt, last.id, last.isPinned, last.isFeatured) : null;
    return { data, nextCursor, total: 0 };
  }

  private static filterSql(filters: CommunityPostFilters | undefined): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.query) {
      const escaped = filters.query.replace(/[\\%_]/gu, character => '\\' + character);
      clauses.push("(nickname LIKE ? ESCAPE '\\' OR original_content LIKE ? ESCAPE '\\' OR content_en LIKE ? ESCAPE '\\' OR content_zh LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM community_post_translations AS filter_translation WHERE filter_translation.post_id = community_posts.id AND filter_translation.content LIKE ? ESCAPE '\\'))");
      const pattern = `%${escaped}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    if (filters?.topic) {
      clauses.push('topic = ?');
      params.push(filters.topic);
    }
    if (filters?.featuredOnly) clauses.push('is_featured = 1');
    if (filters?.githubOnly) {
      clauses.push("EXISTS (SELECT 1 FROM community_embeds AS filter_embed WHERE filter_embed.post_id = community_posts.id AND filter_embed.type = 'repository')");
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
  }

  async getPublicPosts(options: { limit: number; cursor?: { createdAt: string; id: number; isPinned?: number; isFeatured?: number } | null; filters?: CommunityPostFilters }): Promise<CommunityListResult<PublicCommunityPost>> {
    const filter = CommunityRepository.filterSql(options.filters);
    const where = `status = 'approved'${filter.sql}`;
    const result = await this.listPosts(where, filter.params, options.limit, options.cursor ?? null);
    const count = await this.db.prepare(`SELECT COUNT(*) AS count FROM community_posts WHERE ${where}`)
      .bind(...filter.params).first<{ count: number }>();
    return {
      data: result.data.map(toPublicCommunityPost),
      nextCursor: result.nextCursor,
      total: count?.count ?? 0,
    };
  }

  async getAdminPosts(options: { limit: number; status?: CommunityPostStatus | null; cursor?: { createdAt: string; id: number; isPinned?: number; isFeatured?: number } | null; filters?: CommunityPostFilters }): Promise<CommunityListResult<AdminCommunityPost>> {
    const filter = CommunityRepository.filterSql(options.filters);
    const where = `${options.status ? 'status = ?' : '1 = 1'}${filter.sql}`;
    const params = options.status ? [options.status, ...filter.params] : filter.params;
    const result = await this.listPosts(where, params, options.limit, options.cursor ?? null);
    const count = await this.db.prepare(`SELECT COUNT(*) AS count FROM community_posts WHERE ${where}`).bind(...params).first<{ count: number }>();
    return { data: result.data, nextCursor: result.nextCursor, total: count?.count ?? 0 };
  }

  async getCommunityStats(): Promise<CommunityStats> {
    const [totalRow, statusRows, topicRows, embedRow] = await Promise.all([
      this.db.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) AS pinned,
        SUM(CASE WHEN is_featured = 1 THEN 1 ELSE 0 END) AS featured,
        SUM(CASE WHEN translation_status = 'failed' THEN 1 ELSE 0 END) AS translation_failed
        FROM community_posts`).first<{ total: number; pinned: number; featured: number; translation_failed: number }>(),
      this.db.prepare('SELECT status, COUNT(*) AS count FROM community_posts GROUP BY status').all<{ status: string; count: number }>(),
      this.db.prepare('SELECT topic, COUNT(*) AS count FROM community_posts GROUP BY topic').all<{ topic: string; count: number }>(),
      this.db.prepare("SELECT COUNT(*) AS count FROM community_embeds WHERE fetch_status = 'failed'").first<{ count: number }>(),
    ]);
    const byStatus: CommunityStats['byStatus'] = { approved: 0, pending: 0, hidden: 0, deleted: 0 };
    for (const row of statusRows.results) {
      if (row.status in byStatus) byStatus[row.status as CommunityPostStatus] = Number(row.count) || 0;
    }
    const byTopic = Object.fromEntries(COMMUNITY_TOPICS.map(topic => [topic, 0])) as CommunityStats['byTopic'];
    for (const row of topicRows.results) {
      if (isCommunityTopic(row.topic)) byTopic[row.topic] = Number(row.count) || 0;
    }
    return {
      total: Number(totalRow?.total) || 0,
      pinned: Number(totalRow?.pinned) || 0,
      featured: Number(totalRow?.featured) || 0,
      translationFailed: Number(totalRow?.translation_failed) || 0,
      embedFailed: Number(embedRow?.count) || 0,
      byStatus,
      byTopic,
    };
  }

  async getPostById(id: number, includeFailures = true): Promise<CommunityPost | null> {
    const row = await this.db.prepare('SELECT * FROM community_posts WHERE id = ?').bind(id).first<CommunityPostRow>();
    if (!row) return null;
    const [embeds, translations] = await Promise.all([
      this.embedsForPosts([id], includeFailures),
      this.translationsForPosts([id]),
    ]);
    return mapPost(row, embeds.get(id) ?? [], translations.get(id) ?? {});
  }

  async insertPost(input: CommunityPostInsert): Promise<number> {
    // The provenance is always server-derived. A caller may pass authorType
    // explicitly (agent endpoint), but when omitted we infer it from the
    // existing author_role so admin announcements keep `admin` and anonymous
    // posts keep `human`. An agent id is only persisted for agent posts.
    const effectiveAuthorType: CommunityAuthorType = input.authorType
      ?? (input.authorRole === 'admin' ? 'admin' : 'human');
    const effectiveAgentId = effectiveAuthorType === 'agent' ? (input.agentId ?? null) : null;
    const result = await this.db.prepare(`
      INSERT INTO community_posts (
        nickname, original_content, original_language, content_en, content_zh,
        translation_status, translation_provider, translated_at, status,
        created_at, updated_at, source_hash, content_hash, moderation_reason,
        topic, author_role, is_announcement, is_pinned, is_featured,
        author_type, agent_id
      ) VALUES (?, ?, 'und', NULL, NULL, 'pending', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.nickname,
      input.originalContent,
      input.status,
      input.createdAt,
      input.createdAt,
      input.sourceHash,
      input.contentHash,
      input.moderationReason,
      input.topic,
      input.authorRole ?? 'member',
      input.isAnnouncement ? 1 : 0,
      input.isPinned ? 1 : 0,
      input.isFeatured ? 1 : 0,
    ).run();
    return Number(result.meta.last_row_id);
  }

  async updateTranslation(postId: number, update: TranslationUpdate): Promise<void> {
    await this.db.prepare(`
      UPDATE community_posts
      SET original_language = ?, content_en = ?, content_zh = ?,
          translation_status = ?, translation_provider = ?, translated_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      update.originalLanguage,
      update.contentEn,
      update.contentZh,
      update.translationStatus,
      update.translationProvider,
      update.translatedAt,
      update.updatedAt,
      postId,
    ).run();

    const translations = update.translations ?? {
      ...(update.contentEn ? { en: update.contentEn } : {}),
      ...(update.contentZh ? { zh: update.contentZh } : {}),
    };
    for (const [language, content] of Object.entries(translations)) {
      if (!content || !['en', 'zh', 'ja', 'es', 'fr'].includes(language)) continue;
      await this.db.prepare(`
        INSERT INTO community_post_translations (
          post_id, language, content, status, provider, translated_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'translated', ?, ?, ?, ?)
        ON CONFLICT(post_id, language) DO UPDATE SET
          content = excluded.content,
          status = excluded.status,
          provider = excluded.provider,
          translated_at = excluded.translated_at,
          updated_at = excluded.updated_at
      `).bind(
        postId,
        language,
        content,
        update.translationProvider,
        update.translatedAt,
        update.updatedAt,
        update.updatedAt,
      ).run();
    }
  }

  async updatePostStatus(postId: number, status: CommunityPostStatus, moderationReason: string | null, updatedAt: string): Promise<boolean> {
    const result = await this.db.prepare(
      'UPDATE community_posts SET status = ?, moderation_reason = ?, updated_at = ? WHERE id = ?',
    ).bind(status, moderationReason, updatedAt, postId).run();
    return result.meta.changes > 0;
  }

  async updatePostFlags(postId: number, flags: { isPinned?: boolean; isFeatured?: boolean }, updatedAt: string): Promise<boolean> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (flags.isPinned !== undefined) {
      assignments.push('is_pinned = ?');
      params.push(flags.isPinned ? 1 : 0);
    }
    if (flags.isFeatured !== undefined) {
      assignments.push('is_featured = ?');
      params.push(flags.isFeatured ? 1 : 0);
    }
    if (assignments.length === 0) return false;
    assignments.push('updated_at = ?');
    params.push(updatedAt, postId);
    const result = await this.db.prepare(`UPDATE community_posts SET ${assignments.join(', ')} WHERE id = ?`).bind(...params).run();
    return result.meta.changes > 0;
  }

  async findRecentDuplicate(contentHash: string, cutoff: string): Promise<{ id: number; status: CommunityPostStatus } | null> {
    const row = await this.db.prepare(`
      SELECT id, status FROM community_posts
      WHERE content_hash = ? AND created_at >= ? AND status <> 'deleted'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).bind(contentHash, cutoff).first<DuplicateRow>();
    return row ? { id: row.id, status: mapPostStatus(row.status) } : null;
  }

  async getActiveBan(sourceHash: string, now: string): Promise<CommunityBan | null> {
    const row = await this.db.prepare(`
      SELECT * FROM community_bans
      WHERE source_hash = ? AND active = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime(?))
      ORDER BY id DESC LIMIT 1
    `).bind(sourceHash, now).first<{ id: number; source_hash: string; reason: string | null; created_at: string; expires_at: string | null; active: number }>();
    return row ? {
      id: row.id,
      sourceHash: row.source_hash,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      active: row.active === 1,
    } : null;
  }

  /** Atomically reserve all three source windows with one conditional update. */
  async reserveRateLimit(sourceHash: string, nowMs: number, limits: RateLimitConfig): Promise<RateLimitDecision> {
    const nowIso = new Date(nowMs).toISOString();
    await this.db.prepare(`
      INSERT OR IGNORE INTO community_rate_limits (
        source_hash, minute_started_ms, minute_count, hour_started_ms, hour_count,
        day_started_ms, day_count, updated_at
      ) VALUES (?, 0, 0, 0, 0, 0, 0, ?)
    `).bind(sourceHash, nowIso).run();

    const minuteBoundary = nowMs - 60_000;
    const hourBoundary = nowMs - 3_600_000;
    const dayBoundary = nowMs - 86_400_000;
    const result = await this.db.prepare(`
      UPDATE community_rate_limits
      SET minute_started_ms = CASE WHEN minute_started_ms <= ? THEN ? ELSE minute_started_ms END,
          minute_count = CASE WHEN minute_started_ms <= ? THEN 1 ELSE minute_count + 1 END,
          hour_started_ms = CASE WHEN hour_started_ms <= ? THEN ? ELSE hour_started_ms END,
          hour_count = CASE WHEN hour_started_ms <= ? THEN 1 ELSE hour_count + 1 END,
          day_started_ms = CASE WHEN day_started_ms <= ? THEN ? ELSE day_started_ms END,
          day_count = CASE WHEN day_started_ms <= ? THEN 1 ELSE day_count + 1 END,
          updated_at = ?
      WHERE source_hash = ?
        AND (minute_started_ms <= ? OR minute_count < ?)
        AND (hour_started_ms <= ? OR hour_count < ?)
        AND (day_started_ms <= ? OR day_count < ?)
    `).bind(
      minuteBoundary, nowMs, minuteBoundary,
      hourBoundary, nowMs, hourBoundary,
      dayBoundary, nowMs, dayBoundary,
      nowIso, sourceHash,
      minuteBoundary, limits.perMinute,
      hourBoundary, limits.perHour,
      dayBoundary, limits.perDay,
    ).run();

    if (result.meta.changes > 0) return { allowed: true, blockedWindow: null, retryAfterSeconds: 0 };
    const row = await this.db.prepare('SELECT * FROM community_rate_limits WHERE source_hash = ?')
      .bind(sourceHash).first<CommunityRateLimitRow>();
    if (!row) return { allowed: false, blockedWindow: 'minute', retryAfterSeconds: 60 };
    const blocked: Array<{ window: RateLimitDecision['blockedWindow']; retry: number }> = [];
    if (row.minute_started_ms > minuteBoundary && row.minute_count >= limits.perMinute) {
      blocked.push({ window: 'minute', retry: row.minute_started_ms + 60_000 - nowMs });
    }
    if (row.hour_started_ms > hourBoundary && row.hour_count >= limits.perHour) {
      blocked.push({ window: 'hour', retry: row.hour_started_ms + 3_600_000 - nowMs });
    }
    if (row.day_started_ms > dayBoundary && row.day_count >= limits.perDay) {
      blocked.push({ window: 'day', retry: row.day_started_ms + 86_400_000 - nowMs });
    }
    const selected = blocked[0] ?? { window: 'minute' as const, retry: 60_000 };
    return {
      allowed: false,
      blockedWindow: selected.window,
      retryAfterSeconds: Math.max(1, Math.ceil(selected.retry / 1000)),
    };
  }

  async getEmbed(postId: number, canonicalUrl: string): Promise<CommunityEmbed | null> {
    const row = await this.db.prepare(
      'SELECT * FROM community_embeds WHERE post_id = ? AND type = \'repository\' AND canonical_url = ?',
    ).bind(postId, canonicalUrl).first<CommunityEmbedRow>();
    return row ? mapEmbed(row) : null;
  }

  async getFreshEmbed(canonicalUrl: string, cutoff: string): Promise<CommunityEmbed | null> {
    const row = await this.db.prepare(`
      SELECT * FROM community_embeds
      WHERE type = 'repository' AND canonical_url = ? AND fetch_status = 'success'
        AND fetched_at IS NOT NULL AND fetched_at >= ?
      ORDER BY fetched_at DESC, id DESC LIMIT 1
    `).bind(canonicalUrl, cutoff).first<CommunityEmbedRow>();
    return row ? mapEmbed(row) : null;
  }

  async upsertEmbed(input: EmbedUpsert): Promise<void> {
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    await this.db.prepare(`
      INSERT INTO community_embeds (
        post_id, type, provider, url, canonical_url, title, description, image_url,
        metadata_json, fetched_at, created_at, updated_at, fetch_status, last_error, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id, type, canonical_url) DO UPDATE SET
        provider = excluded.provider,
        url = excluded.url,
        title = excluded.title,
        description = excluded.description,
        image_url = excluded.image_url,
        metadata_json = excluded.metadata_json,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at,
        fetch_status = excluded.fetch_status,
        last_error = excluded.last_error,
        retry_count = excluded.retry_count
    `).bind(
      input.postId,
      input.type,
      input.provider,
      input.url,
      input.canonicalUrl,
      input.title,
      input.description,
      input.imageUrl,
      metadataJson,
      input.fetchedAt,
      input.updatedAt,
      input.updatedAt,
      input.fetchStatus,
      input.lastError,
      input.retryCount ?? 0,
    ).run();
  }

  async markEmbedFailure(postId: number, input: Pick<EmbedUpsert, 'url' | 'canonicalUrl' | 'type' | 'provider'>, errorCode: string, updatedAt: string): Promise<void> {
    const existing = await this.getEmbed(postId, input.canonicalUrl);
    await this.upsertEmbed({
      ...input,
      postId,
      title: null,
      description: null,
      imageUrl: null,
      metadata: null,
      fetchedAt: null,
      updatedAt,
      fetchStatus: 'failed',
      lastError: errorCode.slice(0, 80),
      retryCount: (existing?.retryCount ?? 0) + 1,
    });
  }

  async banSource(sourceHash: string, reason: string | null, expiresAt: string | null, createdAt: string): Promise<void> {
    const current = await this.getActiveBan(sourceHash, createdAt);
    if (current) {
      await this.db.prepare('UPDATE community_bans SET reason = ?, expires_at = ?, active = 1 WHERE id = ?')
        .bind(reason, expiresAt, current.id).run();
      return;
    }
    await this.db.prepare(
      'INSERT INTO community_bans (source_hash, reason, created_at, expires_at, active) VALUES (?, ?, ?, ?, 1)',
    ).bind(sourceHash, reason, createdAt, expiresAt).run();
  }

  async unbanSource(sourceHash: string): Promise<number> {
    const result = await this.db.prepare('UPDATE community_bans SET active = 0 WHERE source_hash = ? AND active = 1')
      .bind(sourceHash).run();
    return result.meta.changes;
  }

  async listBans(includeInactive = false): Promise<CommunityBan[]> {
    const query = includeInactive
      ? 'SELECT * FROM community_bans ORDER BY created_at DESC, id DESC LIMIT 500'
      : 'SELECT * FROM community_bans WHERE active = 1 ORDER BY created_at DESC, id DESC LIMIT 500';
    const { results } = await this.db.prepare(query).all<{ id: number; source_hash: string; reason: string | null; created_at: string; expires_at: string | null; active: number }>();
    return results.map(row => ({
      id: row.id,
      sourceHash: row.source_hash,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      active: row.active === 1,
    }));
  }

  /**
   * Atomically reserve one slot in an agent quota bucket. A bucket is a sliding
   * window keyed by `bucketKey` (for example `run:<runId>` or `day:agent`).
   * When the window has expired the counter resets to 1; otherwise it increments
   * only while below `maxCount`. Returns true when the slot was reserved.
   *
   * Mirrors `reserveRateLimit`: the conditional UPDATE either claims a slot or
   * leaves the row untouched, so the check is safe under concurrency.
   */
  async reserveAgentQuota(bucketKey: string, agentId: string | null, nowMs: number, windowMs: number, maxCount: number): Promise<boolean> {
    const boundary = nowMs - windowMs;
    const nowIso = new Date(nowMs).toISOString();
    await this.db.prepare(`
      INSERT OR IGNORE INTO community_agent_quotas (
        bucket_key, window_started_ms, window_ms, count, max_count, agent_id, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?)
    `).bind(bucketKey, nowMs, windowMs, maxCount, agentId, nowIso).run();

    const result = await this.db.prepare(`
      UPDATE community_agent_quotas
      SET count = CASE WHEN window_started_ms <= ? THEN 1 ELSE count + 1 END,
          window_started_ms = CASE WHEN window_started_ms <= ? THEN ? ELSE window_started_ms END,
          agent_id = ?,
          updated_at = ?
      WHERE bucket_key = ?
        AND (window_started_ms <= ? OR count < ?)
    `).bind(
      boundary,
      boundary,
      nowMs,
      agentId,
      nowIso,
      bucketKey,
      boundary,
      maxCount,
    ).run();
    return result.meta.changes > 0;
  }

  /** Roll back a reservation (used when a later, stricter bucket is full). */
  async releaseAgentQuota(bucketKey: string, updatedAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE community_agent_quotas
      SET count = MAX(0, count - 1), updated_at = ?
      WHERE bucket_key = ?
    `).bind(updatedAt, bucketKey).run();
  }

  async getAgentQuota(bucketKey: string): Promise<{ count: number; maxCount: number; windowStartedMs: number; windowMs: number } | null> {
    const row = await this.db.prepare(
      'SELECT count, max_count, window_started_ms, window_ms FROM community_agent_quotas WHERE bucket_key = ?',
    ).bind(bucketKey).first<{ count: number; max_count: number; window_started_ms: number; window_ms: number }>();
    if (!row) return null;
    return {
      count: row.count,
      maxCount: row.max_count,
      windowStartedMs: row.window_started_ms,
      windowMs: row.window_ms,
    };
  }
}
