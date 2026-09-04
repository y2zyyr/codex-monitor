// ============================================================
// Codex Usage Monitor - D1 Repository
// ============================================================
import { EVENT_CATEGORIES, EVENT_TRANSLATION_LOCALES } from '../types';
import type {
  D1SourcePostRow,
  D1MonitorEventRow,
  D1MonitorEventTranslationRow,
  D1MonitorRunRow,
  D1SettingRow,
  SourcePost,
  MonitorEvent,
  MonitorRun,
  Setting,
  EventCategory,
  PaginatedResponse,
  EventHistoryResponse,
  EventQueryOptions,
  D1ProviderUsageRow,
  D1ManualResetReportRow,
  SourceQuality,
  VerificationStatus,
  ManualResetReport,
  ManualResetReportStatus,
  DisplayTimeZone,
  EventTranslationLocale,
  EventTranslationStatus,
  MonitorEventTranslation,
} from '../types';
import { isStaleApproximateReset } from '../utils/search-schedule';
import {
  CHINESE_DISPLAY_TIME_ZONE,
  datePartsInTimeZone,
  isDisplayTimeZone,
  utcForLocalDate,
} from '../utils/timezone';
import { buildCompletedResetHintResult, isCompletedResetHint } from '../classifier/types';

// History is a public-event aggregate. Keep IRRELEVANT out because that
// classifier result is deliberately never inserted into monitor_events.
const HISTORY_CATEGORIES = EVENT_CATEGORIES.filter(
  (category): category is Exclude<EventCategory, 'IRRELEVANT'> => category !== 'IRRELEVANT',
);

const EVENT_SEARCH_EXPRESSION = "LOWER(COALESCE(e.title_en, '') || ' ' || COALESCE(e.title_zh, '') || ' ' || COALESCE(e.summary_en, '') || ' ' || COALESCE(e.summary_zh, '') || ' ' || COALESCE(sp.text, ''))";
const MISSING_EVENT_TRANSLATION_CLAUSE = `(
  ${EVENT_TRANSLATION_LOCALES.map(language => `NOT EXISTS (
    SELECT 1 FROM monitor_event_translations met
    WHERE met.event_id = e.id
      AND met.language = '${language}'
      AND met.status = 'translated'
      AND COALESCE(met.title, '') <> ''
      AND COALESCE(met.summary, '') <> ''
  )`).join('\n  OR ')}
)`;

function shiftDateOnly(date: string, deltaDays: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted.toISOString().slice(0, 10);
}

function qualityRank(quality: string): number {
  if (quality === 'OFFICIAL') return 3;
  if (quality === 'DIRECT') return 2;
  return 1;
}

function verificationRank(status: string | null | undefined): number {
  if (status === 'OFFICIAL_VERIFIED') return 3;
  if (status === 'DIRECT_VERIFIED') return 2;
  if (status === 'INDEXED_ONLY') return 1;
  return 0;
}

function strongestVerification(current: string | null | undefined, incoming: string): string {
  return verificationRank(incoming) >= verificationRank(current) ? incoming : (current ?? incoming);
}

// --- Row Mappers ---
function mapSourcePost(row: D1SourcePostRow): SourcePost {
  return {
    id: row.id,
    source: row.source,
    source_account: row.source_account,
    source_post_id: row.source_post_id,
    source_url: row.source_url,
    text: row.text,
    published_at: row.published_at,
    fetched_at: row.fetched_at,
    raw_json: row.raw_json,
    content_hash: row.content_hash,
    classification_pending: row.classification_pending === 1,
    classification_attempts: row.classification_attempts ?? 0,
    last_classification_attempt_at: row.last_classification_attempt_at,
    classification_error: row.classification_error,
    canonical_platform: row.canonical_platform ?? undefined,
    canonical_post_id: row.canonical_post_id ?? undefined,
    source_quality: (row.source_quality as SourceQuality | null) ?? 'DIRECT',
    first_discovered_via: row.first_discovered_via,
    last_verified_via: row.last_verified_via,
    verified_at: row.verified_at,
    indexed_at: row.indexed_at,
    verification_status: (row.verification_status as VerificationStatus | null) ?? 'DIRECT_VERIFIED',
    created_at: row.created_at,
  };
}

function mapMonitorEvent(row: D1MonitorEventRow & { source_text?: string }): MonitorEvent {
  return {
    id: row.id,
    source_post_id: row.source_post_id,
    source_account: row.source_account,
    category: row.category as EventCategory,
    title_en: row.title_en,
    title_zh: row.title_zh,
    summary_en: row.summary_en,
    summary_zh: row.summary_zh,
    confidence: row.confidence,
    published_at: row.published_at,
    effective_at: row.effective_at,
    reset_at: row.reset_at,
    source_url: row.source_url,
    source_text: row.source_text,
    observed_at: row.observed_at ?? null,
    source_quality: (row.source_quality as SourceQuality | null) ?? undefined,
    evidence_quality: (row.evidence_quality as SourceQuality | null) ?? undefined,
    verification_status: (row.verification_status as VerificationStatus | null) ?? undefined,
    first_discovered_via: row.first_discovered_via,
    last_verified_via: row.last_verified_via,
    verified_at: row.verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMonitorEventTranslation(row: D1MonitorEventTranslationRow): MonitorEventTranslation | null {
  if (!EVENT_TRANSLATION_LOCALES.includes(row.language as EventTranslationLocale)) return null;
  const status: EventTranslationStatus = row.status === 'translated' || row.status === 'failed' || row.status === 'pending'
    ? row.status
    : 'pending';
  return {
    language: row.language as EventTranslationLocale,
    title: row.title,
    summary: row.summary,
    status,
    provider: row.provider,
    translated_at: row.translated_at,
  };
}

function mapMonitorRun(row: D1MonitorRunRow): MonitorRun {
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status as 'running' | 'completed' | 'failed',
    posts_checked: row.posts_checked,
    candidates_found: row.candidates_found,
    events_created: row.events_created,
    x_api_calls: row.x_api_calls ?? 0,
    web_search_calls: row.web_search_calls ?? 0,
    llm_classifications: row.llm_classifications ?? 0,
    error_message: row.error_message,
  };
}

function mapSetting(row: D1SettingRow): Setting {
  return {
    key: row.key,
    value: row.value,
    updated_at: row.updated_at,
  };
}

function mapManualResetReport(row: D1ManualResetReportRow): ManualResetReport {
  return {
    id: row.id,
    telegram_update_id: row.telegram_update_id,
    telegram_message_id: row.telegram_message_id,
    telegram_user_id: row.telegram_user_id,
    telegram_username: row.telegram_username,
    telegram_display_name: row.telegram_display_name,
    telegram_chat_id: row.telegram_chat_id,
    reported_at: row.reported_at,
    reset_at: row.reset_at,
    note: row.note,
    status: row.status as ManualResetReportStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- Repository Class ---
export class Repository {
  constructor(private db: D1Database) {}

  /**
   * Event pages are ordered by publication time, not by the AUTOINCREMENT id.
   * The cursor therefore carries the complete sort key plus the id tie-breaker.
   */
  static encodeEventCursor(sortValue: string, id: number): string {
    return `${encodeURIComponent(sortValue)}|${id}`;
  }

  static decodeEventCursor(raw: string): { sortValue: string; id: number } | null {
    const separator = raw.lastIndexOf('|');
    if (separator <= 0) return null;
    let sortValue: string;
    try {
      sortValue = decodeURIComponent(raw.slice(0, separator));
    } catch {
      return null;
    }
    const id = Number(raw.slice(separator + 1));
    // A cursor is an opaque value generated from a publication timestamp. Do
    // not pass arbitrary strings through to SQLite's julianday() expression:
    // an invalid date silently turns the page into an empty result set.
    if (!sortValue || Number.isNaN(new Date(sortValue).getTime()) || !Number.isInteger(id) || id <= 0) return null;
    return { sortValue, id };
  }

  // ==================== Source Posts ====================

  async insertSourcePost(post: SourcePost): Promise<number | null> {
    const { meta } = await this.db
      .prepare(
        `INSERT OR IGNORE INTO source_posts
          (source, source_account, source_post_id, source_url, text, published_at, fetched_at, raw_json, content_hash, classification_pending, canonical_platform, canonical_post_id, source_quality, first_discovered_via, last_verified_via, verified_at, indexed_at, verification_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        post.source,
        post.source_account,
        post.source_post_id,
        post.source_url,
        post.text,
        post.published_at,
        post.fetched_at,
        post.raw_json,
        post.content_hash,
        post.classification_pending ? 1 : 0,
        post.canonical_platform ?? null,
        post.canonical_post_id ?? null,
        post.source_quality ?? 'DIRECT',
        post.first_discovered_via ?? null,
        post.last_verified_via ?? null,
        post.verified_at ?? null,
        post.indexed_at ?? null,
        post.verification_status ?? (
          post.source_quality === 'INDEXED'
            ? 'INDEXED_ONLY'
            : post.source_quality === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED'
        )
      )
      .run();

    if (meta.changes > 0) {
      return Number(meta.last_row_id);
    }
    return null; // duplicate
  }

  /**
   * Upsert by canonical platform/post id first, then by provider id. This is
   * the critical indexed -> direct upgrade path: the direct X result updates
   * the existing row instead of creating a second source post/event.
   */
  async upsertSourcePost(post: SourcePost, verifiedAt = new Date().toISOString()): Promise<{
    id: number;
    isNew: boolean;
    upgraded: boolean;
  }> {
    let existing: SourcePost | null = null;

    if (post.canonical_platform && post.canonical_post_id) {
      const row = await this.db
        .prepare('SELECT * FROM source_posts WHERE canonical_platform = ? AND canonical_post_id = ? LIMIT 1')
        .bind(post.canonical_platform, post.canonical_post_id)
        .first<D1SourcePostRow>();
      existing = row ? mapSourcePost(row) : null;
    }

    if (!existing) {
      existing = await this.getSourcePostBySourceId(post.source, post.source_post_id);
    }

    if (!existing) {
      const id = await this.insertSourcePost(post);
      if (id === null) {
        // A concurrent insert won the race. Read it back and treat this as a
        // non-new row; the canonical unique index is the final guard.
        const concurrent = post.canonical_platform && post.canonical_post_id
          ? await this.db.prepare('SELECT * FROM source_posts WHERE canonical_platform = ? AND canonical_post_id = ? LIMIT 1')
            .bind(post.canonical_platform, post.canonical_post_id).first<D1SourcePostRow>()
          : await this.db.prepare('SELECT * FROM source_posts WHERE source = ? AND source_post_id = ?')
            .bind(post.source, post.source_post_id).first<D1SourcePostRow>();
        if (!concurrent) throw new Error('Source post insert raced but row could not be read');
        existing = mapSourcePost(concurrent);
      } else {
        return { id, isNew: true, upgraded: false };
      }
    }

    // Rejected evidence is terminal. A later indexed/direct observation of
    // the same post must not resurrect it or make its event visible again.
    if (existing.verification_status === 'REJECTED') {
      await this.db.prepare('UPDATE source_posts SET fetched_at = ? WHERE id = ?')
        .bind(post.fetched_at, existing.id!).run();
      return { id: existing.id!, isNew: false, upgraded: false };
    }

    const incomingQuality = post.source_quality ?? 'DIRECT';
    const existingQuality = existing.source_quality ?? 'DIRECT';
    const shouldUpgrade = qualityRank(incomingQuality) > qualityRank(existingQuality);

    // Evidence quality is monotonic. In particular, an indexed/direct retry
    // must never replace an already verified official source.
    if (qualityRank(incomingQuality) < qualityRank(existingQuality)) {
      await this.db.prepare(`
        UPDATE source_posts SET
          fetched_at = ?,
          indexed_at = COALESCE(indexed_at, ?),
          published_at = COALESCE(published_at, ?)
        WHERE id = ?
      `).bind(post.fetched_at, post.indexed_at ?? post.fetched_at, post.published_at, existing.id!).run();
      return { id: existing.id!, isNew: false, upgraded: false };
    }

    if (shouldUpgrade || incomingQuality === 'DIRECT' || incomingQuality === 'OFFICIAL') {
      const hasEvent = await this.hasEventForSourcePost(existing.id!);
      await this.db.prepare(`
        UPDATE source_posts SET
          source = ?,
          source_account = ?,
          source_post_id = ?,
          source_url = ?,
          text = ?,
          published_at = COALESCE(?, published_at),
          fetched_at = ?,
          raw_json = ?,
          content_hash = ?,
          canonical_platform = COALESCE(?, canonical_platform),
          canonical_post_id = COALESCE(?, canonical_post_id),
          source_quality = ?,
          first_discovered_via = COALESCE(first_discovered_via, ?),
          last_verified_via = ?,
          verified_at = ?,
          indexed_at = COALESCE(indexed_at, ?),
          verification_status = ?,
          classification_pending = CASE
            WHEN ? = 1 THEN 1
            WHEN ? = 1 THEN classification_pending
            ELSE 1
          END
        WHERE id = ?
      `).bind(
        shouldUpgrade ? post.source : existing.source,
        post.source_account,
        shouldUpgrade ? post.source_post_id : existing.source_post_id,
        shouldUpgrade ? post.source_url : existing.source_url,
        shouldUpgrade ? post.text : existing.text,
        shouldUpgrade ? post.published_at : existing.published_at,
        post.fetched_at,
        shouldUpgrade ? post.raw_json : existing.raw_json,
        shouldUpgrade ? post.content_hash : existing.content_hash,
        post.canonical_platform ?? existing.canonical_platform ?? null,
        post.canonical_post_id ?? existing.canonical_post_id ?? null,
        shouldUpgrade ? incomingQuality : existingQuality,
        post.first_discovered_via ?? null,
        incomingQuality === 'INDEXED' ? existing.last_verified_via ?? null : (post.last_verified_via ?? 'x_api'),
        incomingQuality === 'INDEXED' ? existing.verified_at ?? null : (post.verified_at ?? verifiedAt),
        post.indexed_at ?? null,
        incomingQuality === 'INDEXED'
          ? (existing.verification_status ?? 'INDEXED_ONLY')
          : incomingQuality === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED',
        shouldUpgrade ? 1 : 0,
        hasEvent ? 1 : 0,
        existing.id!
      ).run();

      if (incomingQuality !== 'INDEXED') {
        await this.upgradeEventForSourcePost(existing.id!, post, verifiedAt);
      }
      return { id: existing.id!, isNew: false, upgraded: shouldUpgrade };
    }

    // A repeated indexed result must never downgrade a direct source.
    await this.db.prepare(`
      UPDATE source_posts SET
        fetched_at = ?,
        indexed_at = COALESCE(indexed_at, ?),
        published_at = COALESCE(published_at, ?)
      WHERE id = ?
    `).bind(post.fetched_at, post.indexed_at ?? post.fetched_at, post.published_at, existing.id!).run();
    if (post.published_at) {
      await this.db.prepare(`
        UPDATE monitor_events SET
          published_at = COALESCE(published_at, ?),
          updated_at = ?
        WHERE source_post_id = ?
          AND published_at IS NULL
          AND verification_status <> 'REJECTED'
      `).bind(post.published_at, post.fetched_at, existing.id!).run();
    }
    return { id: existing.id!, isNew: false, upgraded: false };
  }

  async getSourcePostBySourceId(source: string, sourcePostId: string): Promise<SourcePost | null> {
    const row = await this.db
      .prepare('SELECT * FROM source_posts WHERE source = ? AND source_post_id = ?')
      .bind(source, sourcePostId)
      .first<D1SourcePostRow>();
    return row ? mapSourcePost(row) : null;
  }

  async getSourcePostById(id: number): Promise<SourcePost | null> {
    const row = await this.db
      .prepare('SELECT * FROM source_posts WHERE id = ?')
      .bind(id)
      .first<D1SourcePostRow>();
    return row ? mapSourcePost(row) : null;
  }

  async getSourcePostByCanonical(platform: string, postId: string): Promise<SourcePost | null> {
    const row = await this.db
      .prepare('SELECT * FROM source_posts WHERE canonical_platform = ? AND canonical_post_id = ? LIMIT 1')
      .bind(platform, postId)
      .first<D1SourcePostRow>();
    return row ? mapSourcePost(row) : null;
  }

  private async hasEventForSourcePost(sourcePostId: number): Promise<boolean> {
    const row = await this.db.prepare('SELECT id FROM monitor_events WHERE source_post_id = ? LIMIT 1')
      .bind(sourcePostId).first<{ id: number }>();
    return !!row;
  }

  private async upgradeEventForSourcePost(sourcePostId: number, post: SourcePost, verifiedAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE monitor_events SET
        source_url = ?,
        published_at = COALESCE(?, published_at),
        evidence_quality = ?,
        verification_status = ?,
        verified_at = ?,
        updated_at = ?
      WHERE source_post_id = ? AND verification_status <> 'REJECTED'
    `).bind(
      post.source_url,
      post.published_at,
      post.source_quality ?? 'DIRECT',
      post.source_quality === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED',
      verifiedAt,
      verifiedAt,
      sourcePostId
    ).run();

    // A web-indexed event may have been classified before the authoritative
    // X observation arrived. Re-apply the deterministic completion rule on
    // upgrade so direct evidence can correct RESET_PLANNED (or another weak
    // LLM classification) instead of only changing the provenance badge.
    const completedResult = isCompletedResetHint(post)
      ? buildCompletedResetHintResult(post)
      : null;
    if (completedResult) {
      await this.db.prepare(`
        UPDATE monitor_events SET
          category = 'RESET_COMPLETED',
          title_en = ?,
          title_zh = ?,
          summary_en = ?,
          summary_zh = ?,
          confidence = ?,
          effective_at = NULL,
          reset_at = NULL,
          updated_at = ?
        WHERE source_post_id = ? AND verification_status <> 'REJECTED'
      `).bind(
        completedResult.title_en,
        completedResult.title_zh,
        completedResult.summary_en,
        completedResult.summary_zh,
        completedResult.confidence,
        verifiedAt,
        sourcePostId
      ).run();
    }

    const eventRow = await this.db.prepare(
      'SELECT id FROM monitor_events WHERE source_post_id = ? AND verification_status <> \'REJECTED\' LIMIT 1'
    ).bind(sourcePostId).first<{ id: number }>();
    if (eventRow?.id) {
      // Updating the evidence fields alone is not enough. A direct/official
      // observation must replay the lifecycle transition so an indexed
      // RESET_COMPLETED can promote its existing cycle instead of remaining
      // EXPIRED_UNCONFIRMED forever.
      const upgradedEvent = await this.getEventById(eventRow.id);
      if (upgradedEvent) await this.handleResetEvent(upgradedEvent);
    }
  }

  async rejectSourcePost(sourcePostId: number, reason: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE source_posts SET verification_status = 'REJECTED', classification_pending = 0,
        classification_error = ?, verified_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(reason, now, now, sourcePostId).run();
    await this.db.prepare(`
      UPDATE monitor_events SET verification_status = 'REJECTED', updated_at = ?
      WHERE source_post_id = ?
    `).bind(now, sourcePostId).run();
    await this.db.prepare(`
      UPDATE reset_cycles SET verification_status = 'REJECTED', updated_at = ?
      WHERE planned_event_id IN (SELECT id FROM monitor_events WHERE source_post_id = ?)
         OR time_changed_event_id IN (SELECT id FROM monitor_events WHERE source_post_id = ?)
         OR completed_event_id IN (SELECT id FROM monitor_events WHERE source_post_id = ?)
    `).bind(now, sourcePostId, sourcePostId, sourcePostId).run();
  }

  async getUnclassifiedPosts(limit = 50): Promise<SourcePost[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM source_posts WHERE classification_pending = 1 AND classification_attempts < 5 ORDER BY published_at DESC LIMIT ?')
      .bind(limit)
      .all<D1SourcePostRow>();
    return results.map(mapSourcePost);
  }

  /**
   * Return recent authoritative X posts that have no event yet. This is a
   * small recovery queue for deterministic rules added after a post was first
   * classified. It is deliberately D1-only; it never refetches from X.
   */
  async getDirectPostsWithoutEvents(limit = 50): Promise<SourcePost[]> {
    const { results } = await this.db
      .prepare(`
        SELECT sp.*
        FROM source_posts sp
        LEFT JOIN monitor_events e ON e.source_post_id = sp.id
        WHERE e.id IS NULL
          AND sp.canonical_platform = 'x'
          AND COALESCE(sp.source_quality, 'DIRECT') IN ('DIRECT', 'OFFICIAL')
          AND COALESCE(sp.verification_status, 'DIRECT_VERIFIED') <> 'REJECTED'
          AND COALESCE(sp.classification_attempts, 0) < 5
        ORDER BY COALESCE(sp.published_at, sp.fetched_at) DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<D1SourcePostRow>();
    return results.map(mapSourcePost);
  }

  async markClassified(id: number): Promise<void> {
    await this.db
      .prepare('UPDATE source_posts SET classification_pending = 0, classification_attempts = classification_attempts + 1, last_classification_attempt_at = datetime(\'now\') WHERE id = ?')
      .bind(id)
      .run();
  }

  async updateClassificationRetry(id: number, attempts: number, lastAttemptAt: string, error: string): Promise<void> {
    await this.db
      .prepare('UPDATE source_posts SET classification_pending = 1, classification_attempts = ?, last_classification_attempt_at = ?, classification_error = ? WHERE id = ?')
      .bind(attempts, lastAttemptAt, error, id)
      .run();
  }

  async getLatestPostsByAccount(account: string, limit = 20): Promise<SourcePost[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM source_posts WHERE source_account = ? ORDER BY published_at DESC LIMIT ?')
      .bind(account, limit)
      .all<D1SourcePostRow>();
    return results.map(mapSourcePost);
  }

  async getPostCount(): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM source_posts')
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  // ==================== Monitor Events ====================

  private async eventTranslationsForEvents(
    eventIds: number[],
  ): Promise<Map<number, Partial<Record<EventTranslationLocale, MonitorEventTranslation>>>> {
    const grouped = new Map<number, Partial<Record<EventTranslationLocale, MonitorEventTranslation>>>();
    if (eventIds.length === 0) return grouped;
    const placeholders = eventIds.map(() => '?').join(',');
    const { results } = await this.db.prepare(`
      SELECT id, event_id, language, title, summary, status, provider, translated_at, last_error, created_at, updated_at
      FROM monitor_event_translations
      WHERE event_id IN (${placeholders})
      ORDER BY event_id ASC, id ASC
    `).bind(...eventIds).all<D1MonitorEventTranslationRow>();
    for (const row of results) {
      const translation = mapMonitorEventTranslation(row);
      if (!translation) continue;
      const translations = grouped.get(row.event_id) ?? {};
      translations[translation.language] = translation;
      grouped.set(row.event_id, translations);
    }
    return grouped;
  }

  private async attachEventTranslations(events: MonitorEvent[]): Promise<MonitorEvent[]> {
    if (events.length === 0) return events;
    const translations = await this.eventTranslationsForEvents(
      events.filter(event => event.id !== undefined).map(event => event.id!),
    );
    return events.map(event => ({
      ...event,
      translations: event.id === undefined ? undefined : translations.get(event.id) ?? {},
    }));
  }

  async upsertEventTranslation(input: {
    eventId: number;
    language: EventTranslationLocale;
    title: string | null;
    summary: string | null;
    status: EventTranslationStatus;
    provider: string | null;
    translatedAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO monitor_event_translations (
        event_id, language, title, summary, status, provider, translated_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, language) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        provider = excluded.provider,
        translated_at = excluded.translated_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).bind(
      input.eventId,
      input.language,
      input.title,
      input.summary,
      input.status,
      input.provider,
      input.translatedAt,
      input.lastError,
      input.createdAt,
      input.updatedAt,
    ).run();
  }

  async getEventsNeedingTranslations(limit = 1): Promise<MonitorEvent[]> {
    const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 10)) : 1;
    const { results } = await this.db.prepare(`
      SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
      FROM monitor_events e
      JOIN source_posts sp ON e.source_post_id = sp.id
      WHERE e.verification_status <> 'REJECTED'
        AND ${MISSING_EVENT_TRANSLATION_CLAUSE}
      ORDER BY julianday(COALESCE(e.published_at, e.created_at)) ASC, e.id ASC
      LIMIT ?
    `).bind(boundedLimit).all<D1MonitorEventRow & { source_text: string }>();
    return this.attachEventTranslations(results.map(mapMonitorEvent));
  }

  async countEventsNeedingTranslations(): Promise<number> {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM monitor_events e
      WHERE e.verification_status <> 'REJECTED'
        AND ${MISSING_EVENT_TRANSLATION_CLAUSE}
    `).first<{ count: number }>();
    return Number(row?.count) || 0;
  }

  async insertEvent(event: Omit<MonitorEvent, 'id' | 'created_at' | 'updated_at'>): Promise<number | null> {
    const { meta } = await this.db
      .prepare(
        `INSERT OR IGNORE INTO monitor_events
          (source_post_id, category, title_en, title_zh, summary_en, summary_zh, confidence, published_at, effective_at, reset_at, source_url, evidence_quality, verification_status, verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.source_post_id,
        event.category,
        event.title_en,
        event.title_zh,
        event.summary_en,
        event.summary_zh,
        event.confidence,
        event.published_at,
        event.effective_at,
        event.reset_at,
        event.source_url,
        event.source_quality ?? event.evidence_quality ?? 'DIRECT',
        event.verification_status ?? (event.source_quality === 'INDEXED' ? 'INDEXED_ONLY' : 'DIRECT_VERIFIED'),
        event.verified_at ?? null
      )
      .run();

    if (meta.changes > 0) {
      return Number(meta.last_row_id);
    }
    return null; // duplicate
  }

  async getEventById(id: number): Promise<MonitorEvent | null> {
    const row = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        WHERE e.id = ? AND e.verification_status <> 'REJECTED'
      `)
      .bind(id)
      .first<D1MonitorEventRow & { source_text: string }>();
    if (!row) return null;
    const [event] = await this.attachEventTranslations([mapMonitorEvent(row)]);
    return event ?? null;
  }

  async getEvents(options: EventQueryOptions = {}): Promise<PaginatedResponse<MonitorEvent>> {
    const requestedLimit = options.limit ?? 20;
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 100))
      : 20;
    const cursor = options.cursor ?? null;
    const category = options.category;
    const categories = (options.categories ?? []).filter(Boolean);
    const query = options.q?.trim() || '';
    const startDate = options.startDate?.trim() || '';
    const endDate = options.endDate?.trim() || '';
    const timeZone: DisplayTimeZone = isDisplayTimeZone(options.timeZone)
      ? options.timeZone
      : CHINESE_DISPLAY_TIME_ZONE;

    let whereClause = "WHERE e.verification_status <> 'REJECTED'";
    let bindParams: any[] = [];
    let countWhereClause = "WHERE e.verification_status <> 'REJECTED'";
    let countBindParams: any[] = [];

    if (cursor) {
      whereClause += `
        AND (
          julianday(COALESCE(e.published_at, e.created_at)) < julianday(?)
          OR (julianday(COALESCE(e.published_at, e.created_at)) = julianday(?) AND e.id < ?)
        )`;
      bindParams.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }

    if (category && category !== 'ALL') {
      whereClause += ' AND e.category = ?';
      bindParams.push(category);
      countWhereClause += ' AND e.category = ?';
      countBindParams.push(category);
    } else if (categories.length > 0) {
      const placeholders = categories.map(() => '?').join(', ');
      whereClause += ` AND e.category IN (${placeholders})`;
      bindParams.push(...categories);
      countWhereClause += ` AND e.category IN (${placeholders})`;
      countBindParams.push(...categories);
    }

    // Search is deliberately implemented with bound parameters and INSTR,
    // rather than LIKE, so user input cannot act as a wildcard. The joined
    // source text makes the search useful even when a generated summary does
    // not contain the term used in the original post.
    if (query) {
      whereClause += ` AND INSTR(${EVENT_SEARCH_EXPRESSION}, LOWER(?)) > 0`;
      bindParams.push(query.toLowerCase());
      countWhereClause += ` AND INSTR(${EVENT_SEARCH_EXPRESSION}, LOWER(?)) > 0`;
      countBindParams.push(query.toLowerCase());
    }

    if (startDate) {
      const startUtc = utcForLocalDate(startDate, timeZone).toISOString();
      whereClause += ' AND datetime(COALESCE(e.published_at, e.created_at)) >= datetime(?)';
      bindParams.push(startUtc);
      countWhereClause += ' AND datetime(COALESCE(e.published_at, e.created_at)) >= datetime(?)';
      countBindParams.push(startUtc);
    }

    if (endDate) {
      const endExclusiveUtc = utcForLocalDate(shiftDateOnly(endDate, 1), timeZone).toISOString();
      whereClause += ' AND datetime(COALESCE(e.published_at, e.created_at)) < datetime(?)';
      bindParams.push(endExclusiveUtc);
      countWhereClause += ' AND datetime(COALESCE(e.published_at, e.created_at)) < datetime(?)';
      countBindParams.push(endExclusiveUtc);
    }

    const { results } = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        ${whereClause}
        ORDER BY julianday(COALESCE(e.published_at, e.created_at)) DESC, e.id DESC
        LIMIT ?`
      )
      .bind(...bindParams, limit + 1)
      .all<D1MonitorEventRow & { source_text: string }>();

    const hasMore = results.length > limit;
    const items = await this.attachEventTranslations(results.slice(0, limit).map(mapMonitorEvent));
    const lastItem = items[items.length - 1];
    const lastSortValue = lastItem?.published_at ?? lastItem?.created_at ?? null;
    const nextCursor = hasMore && lastItem?.id && lastSortValue
      ? Repository.encodeEventCursor(lastSortValue, lastItem.id)
      : null;

    const countFromClause = query
      ? 'FROM monitor_events e JOIN source_posts sp ON e.source_post_id = sp.id'
      : 'FROM monitor_events e';
    const countRow = await this.db
      .prepare(`
        SELECT COUNT(*) as count
        ${countFromClause}
        ${countWhereClause}
      `)
      .bind(...countBindParams)
      .first<{ count: number }>();

    return {
      data: items,
      nextCursor,
      total: countRow?.count ?? 0,
    };
  }

  /** Fetch every matching event for exports and other bounded public views. */
  async getAllEvents(options: Omit<EventQueryOptions, 'limit' | 'cursor'> = {}): Promise<MonitorEvent[]> {
    const all: MonitorEvent[] = [];
    let cursor: { sortValue: string; id: number } | null = null;
    let pageCount = 0;
    do {
      const page = await this.getEvents({ ...options, limit: 100, cursor });
      all.push(...page.data);
      cursor = page.nextCursor ? Repository.decodeEventCursor(page.nextCursor) : null;
      pageCount += 1;
    } while (cursor && pageCount < 500);
    return all;
  }

  /** Return zero-filled daily event totals in the requested interface timezone. */
  async getEventHistory(options: { days?: number; now?: Date; timeZone?: DisplayTimeZone } = {}): Promise<EventHistoryResponse> {
    const days = Number.isInteger(options.days) ? Math.max(1, Math.min(options.days as number, 366)) : 30;
    const timeZone: DisplayTimeZone = isDisplayTimeZone(options.timeZone)
      ? options.timeZone
      : CHINESE_DISPLAY_TIME_ZONE;
    const now = options.now ?? new Date();
    const nowParts = datePartsInTimeZone(now, timeZone);
    const endDate = nowParts?.year && nowParts.month && nowParts.day
      ? `${nowParts.year}-${nowParts.month}-${nowParts.day}`
      : new Date(now).toISOString().slice(0, 10);
    const startDate = shiftDateOnly(endDate, -(days - 1));
    const endExclusiveDate = shiftDateOnly(endDate, 1);
    const startUtc = utcForLocalDate(startDate, timeZone).toISOString();
    const endExclusiveUtc = utcForLocalDate(endExclusiveDate, timeZone).toISOString();
    const { results } = await this.db.prepare(`
      SELECT COALESCE(e.published_at, e.created_at) AS event_timestamp, e.category
      FROM monitor_events e
      JOIN source_posts sp ON e.source_post_id = sp.id
      WHERE e.verification_status <> 'REJECTED'
        AND datetime(COALESCE(e.published_at, e.created_at)) >= datetime(?)
        AND datetime(COALESCE(e.published_at, e.created_at)) < datetime(?)
    `).bind(startUtc, endExclusiveUtc).all<{ event_timestamp: string; category: string }>();

    const categoryTotals: Record<string, number> = Object.fromEntries(
      HISTORY_CATEGORIES.map(category => [category, 0]),
    );
    const points: EventHistoryResponse['points'] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = shiftDateOnly(startDate, offset);
      points.push({
        date,
        total: 0,
        categories: Object.fromEntries(HISTORY_CATEGORIES.map(category => [category, 0])),
      });
    }

    const pointByDate = new Map(points.map(point => [point.date, point]));
    for (const row of results) {
      const eventDate = datePartsInTimeZone(row.event_timestamp, timeZone);
      if (!eventDate) continue;
      const point = pointByDate.get(`${eventDate.year}-${eventDate.month}-${eventDate.day}`);
      if (!point || !Object.prototype.hasOwnProperty.call(point.categories, row.category)) continue;
      point.categories[row.category] += 1;
      point.total += 1;
      categoryTotals[row.category] += 1;
    }

    return {
      startDate,
      endDate,
      timeZone,
      total: points.reduce((sum, point) => sum + point.total, 0),
      categoryTotals,
      points,
    };
  }

  async getLatestEvent(): Promise<MonitorEvent | null> {
    const row = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        WHERE e.verification_status <> 'REJECTED'
        ORDER BY julianday(COALESCE(e.published_at, e.created_at)) DESC, e.id DESC
        LIMIT 1
      `)
      .first<D1MonitorEventRow & { source_text: string }>();
    if (!row) return null;
    const [event] = await this.attachEventTranslations([mapMonitorEvent(row)]);
    return event ?? null;
  }

  async getLatestResetEvent(): Promise<MonitorEvent | null> {
    const row = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        WHERE e.category = 'RESET_COMPLETED'
          AND e.verification_status <> 'REJECTED'
        ORDER BY julianday(COALESCE(e.published_at, e.created_at)) DESC, e.id DESC
        LIMIT 1
      `)
      .first<D1MonitorEventRow & { source_text: string }>();
    if (!row) return null;
    const [event] = await this.attachEventTranslations([mapMonitorEvent(row)]);
    return event ?? null;
  }

  /**
   * Return the newest completed reset backed by a direct/official source.
   * This is kept separate from getLatestResetEvent because indexed completion
   * events are useful history but must not outrank an operator report.
   */
  async getLatestDirectResetEvent(): Promise<MonitorEvent | null> {
    const row = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        WHERE e.category = 'RESET_COMPLETED'
          AND e.verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
          AND e.evidence_quality IN ('DIRECT', 'OFFICIAL')
          AND sp.source_quality IN ('DIRECT', 'OFFICIAL')
        ORDER BY julianday(COALESCE(e.published_at, e.created_at)) DESC, e.id DESC
        LIMIT 1
      `)
      .first<D1MonitorEventRow & { source_text: string }>();
    if (!row) return null;
    const [event] = await this.attachEventTranslations([mapMonitorEvent(row)]);
    return event ?? null;
  }

  async getLatestPolicyEvent(): Promise<MonitorEvent | null> {
    const row = await this.db
      .prepare(`
        SELECT e.*, sp.source_account, sp.text as source_text, sp.fetched_at as observed_at, sp.source_quality, sp.first_discovered_via, sp.last_verified_via
        FROM monitor_events e
        JOIN source_posts sp ON e.source_post_id = sp.id
        WHERE e.category = 'POLICY_CHANGE'
          AND e.verification_status <> 'REJECTED'
        ORDER BY julianday(COALESCE(e.published_at, e.created_at)) DESC, e.id DESC
        LIMIT 1
      `)
      .first<D1MonitorEventRow & { source_text: string }>();
    if (!row) return null;
    const [event] = await this.attachEventTranslations([mapMonitorEvent(row)]);
    return event ?? null;
  }

  async getEventCount(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) as count FROM monitor_events WHERE verification_status <> 'REJECTED'")
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  // ==================== Monitor Runs ====================

  async insertRun(run: Omit<MonitorRun, 'id'>): Promise<number> {
    const { meta } = await this.db
      .prepare(
        `INSERT INTO monitor_runs
          (started_at, finished_at, status, posts_checked, candidates_found, events_created, x_api_calls, web_search_calls, llm_classifications, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        run.started_at,
        run.finished_at,
        run.status,
        run.posts_checked,
        run.candidates_found,
        run.events_created,
        run.x_api_calls ?? 0,
        run.web_search_calls ?? 0,
        run.llm_classifications ?? 0,
        run.error_message
      )
      .run();
    return Number(meta.last_row_id);
  }

  async updateRun(id: number, updates: Partial<Omit<MonitorRun, 'id'>>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.finished_at !== undefined) { sets.push('finished_at = ?'); params.push(updates.finished_at); }
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.posts_checked !== undefined) { sets.push('posts_checked = ?'); params.push(updates.posts_checked); }
    if (updates.candidates_found !== undefined) { sets.push('candidates_found = ?'); params.push(updates.candidates_found); }
    if (updates.events_created !== undefined) { sets.push('events_created = ?'); params.push(updates.events_created); }
    if (updates.x_api_calls !== undefined) { sets.push('x_api_calls = ?'); params.push(updates.x_api_calls); }
    if (updates.web_search_calls !== undefined) { sets.push('web_search_calls = ?'); params.push(updates.web_search_calls); }
    if (updates.llm_classifications !== undefined) { sets.push('llm_classifications = ?'); params.push(updates.llm_classifications); }
    if (updates.error_message !== undefined) { sets.push('error_message = ?'); params.push(updates.error_message); }

    if (sets.length === 0) return;

    params.push(id);
    await this.db
      .prepare(`UPDATE monitor_runs SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  async getLatestRun(): Promise<MonitorRun | null> {
    const row = await this.db
      .prepare('SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 1')
      .first<D1MonitorRunRow>();
    return row ? mapMonitorRun(row) : null;
  }

  async getLatestSuccessfulRun(): Promise<MonitorRun | null> {
    const row = await this.db
      .prepare("SELECT * FROM monitor_runs WHERE status = 'completed' AND error_message IS NULL ORDER BY finished_at DESC, id DESC LIMIT 1")
      .first<D1MonitorRunRow>();
    return row ? mapMonitorRun(row) : null;
  }

  async getRecentRuns(limit = 10): Promise<MonitorRun[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT ?')
      .bind(limit)
      .all<D1MonitorRunRow>();
    return results.map(mapMonitorRun);
  }

  // ==================== Settings ====================

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(key, value)
      .run();
  }

  /** Advance an X cursor only when the incoming Snowflake id is newer. */
  async advanceXApiCursor(account: string, candidate: string): Promise<boolean> {
    if (!/^\d+$/.test(candidate)) return false;
    const key = `x_api_since_id:${account}`;
    const now = new Date().toISOString();
    const { meta } = await this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      WHERE settings.value = ''
         OR length(settings.value) < length(excluded.value)
         OR (length(settings.value) = length(excluded.value) AND settings.value < excluded.value)
    `).bind(key, candidate, now).run();
    return meta.changes > 0;
  }

  /**
   * Acquire a short-lived D1-backed lock. The value is an ISO expiry, so a
   * crashed Worker cannot hold the lock forever and concurrent Cron/manual
   * triggers cannot run the same X slot at once.
   */
  async acquireLock(key: string, now: Date, ttlSeconds = 600): Promise<string | null> {
    const acquiredUntil = new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000).toISOString();
    const nowIso = now.toISOString();
    const { meta } = await this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      WHERE settings.value <= ?
    `).bind(key, acquiredUntil, nowIso, nowIso).run();
    return meta.changes > 0 ? acquiredUntil : null;
  }

  async releaseLock(key: string, lockValue: string): Promise<void> {
    await this.db.prepare('DELETE FROM settings WHERE key = ? AND value = ?')
      .bind(key, lockValue).run();
  }

  async getSourcePostCountForDate(source: string, date: string): Promise<number> {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM source_posts
      WHERE source = ? AND date(fetched_at, '+8 hours') = ?
    `).bind(source, date).first<{ count: number }>();
    return row?.count ?? 0;
  }

  // ==================== Operator Reports ====================

  /**
   * Store one Telegram update idempotently. Telegram may retry a webhook, so
   * the caller can safely repeat this operation after a transient failure.
   */
  async insertManualResetReport(
    report: Omit<ManualResetReport, 'id' | 'created_at' | 'updated_at' | 'status'>
      & { status?: ManualResetReportStatus },
  ): Promise<{ report: ManualResetReport; created: boolean }> {
    const now = new Date().toISOString();
    const { meta } = await this.db.prepare(`
      INSERT OR IGNORE INTO manual_reset_reports (
        telegram_update_id,
        telegram_message_id,
        telegram_user_id,
        telegram_username,
        telegram_display_name,
        telegram_chat_id,
        reported_at,
        reset_at,
        note,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      report.telegram_update_id,
      report.telegram_message_id,
      report.telegram_user_id,
      report.telegram_username,
      report.telegram_display_name,
      report.telegram_chat_id,
      report.reported_at,
      report.reset_at,
      report.note,
      report.status ?? 'ACTIVE',
      now,
      now,
    ).run();

    const row = await this.db.prepare(
      'SELECT * FROM manual_reset_reports WHERE telegram_update_id = ?',
    ).bind(report.telegram_update_id).first<D1ManualResetReportRow>();
    if (!row) throw new Error('Manual reset report was not persisted');
    return { report: mapManualResetReport(row), created: meta.changes > 0 };
  }

  async getLatestManualResetReport(): Promise<ManualResetReport | null> {
    const row = await this.db.prepare(`
      SELECT * FROM manual_reset_reports
      WHERE status = 'ACTIVE'
      ORDER BY julianday(reset_at) DESC, id DESC
      LIMIT 1
    `).first<D1ManualResetReportRow>();
    return row ? mapManualResetReport(row) : null;
  }

  async revokeLatestManualResetReport(): Promise<ManualResetReport | null> {
    const current = await this.getLatestManualResetReport();
    if (!current || current.id === undefined) return null;
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE manual_reset_reports
      SET status = 'REVOKED', updated_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).bind(now, current.id).run();
    return { ...current, status: 'REVOKED', updated_at: now };
  }

  // ==================== Provider Status ====================

  async recordProviderStatus(providerName: string, status: string, lastSuccessAt: string | null, lastError: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO provider_status (provider_name, status, last_success_at, last_error_at, checked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider_name) DO UPDATE SET
          status = excluded.status,
          last_success_at = COALESCE(excluded.last_success_at, provider_status.last_success_at),
          last_error_at = CASE WHEN excluded.status IN ('down','not_configured','degraded') THEN excluded.checked_at ELSE provider_status.last_error_at END,
          last_error_message = CASE WHEN excluded.status IN ('down','not_configured','degraded') THEN ? ELSE NULL END,
          checked_at = excluded.checked_at
      `)
      .bind(providerName, status, lastSuccessAt, status === 'down' || status === 'degraded' ? now : null, now, lastError)
      .run();
  }

  async getProviderStatus(providerName: string): Promise<{ status: string; last_success_at: string | null; last_error_at: string | null; last_error_message: string | null } | null> {
    const row = await this.db
      .prepare('SELECT status, last_success_at, last_error_at, last_error_message FROM provider_status WHERE provider_name = ?')
      .bind(providerName)
      .first<{ status: string; last_success_at: string | null; last_error_at: string | null; last_error_message: string | null }>();
    return row ?? null;
  }

  async getAllProviderStatuses(): Promise<Array<{ provider_name: string; status: string; last_success_at: string | null }>> {
    const { results } = await this.db
      .prepare('SELECT provider_name, status, last_success_at, checked_at FROM provider_status ORDER BY provider_name')
      .all<{ provider_name: string; status: string; last_success_at: string | null; checked_at: string }>();
    return results;
  }

  // ==================== Provider Usage Budgets ====================

  async getProviderUsage(provider: string, usageDate: string): Promise<D1ProviderUsageRow | null> {
    return await this.db
      .prepare('SELECT * FROM provider_usage WHERE provider = ? AND usage_date = ?')
      .bind(provider, usageDate)
      .first<D1ProviderUsageRow>();
  }

  /**
   * Atomically reserves one logical provider operation. The conditional
   * upsert is the hard guard against concurrent Cron/manual invocations.
   */
  async reserveProviderUsage(
    provider: string,
    usageDate: string,
    dailyLimit: number,
    requestedAt: string,
    requestSlot: string,
  ): Promise<boolean> {
    if (dailyLimit <= 0) return false;
    const { meta } = await this.db.prepare(`
      INSERT INTO provider_usage
        (provider, usage_date, request_count, last_request_at, last_request_slot, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(provider, usage_date) DO UPDATE SET
        request_count = provider_usage.request_count + 1,
        last_request_at = excluded.last_request_at,
        last_request_slot = excluded.last_request_slot,
        updated_at = excluded.updated_at
      WHERE provider_usage.request_count < ?
        AND (provider_usage.last_request_slot IS NULL OR provider_usage.last_request_slot <> ?)
    `).bind(
      provider,
      usageDate,
      requestedAt,
      requestSlot,
      requestedAt,
      requestedAt,
      dailyLimit,
      requestSlot,
    ).run();
    return meta.changes > 0;
  }

  async recordProviderUsageSuccess(provider: string, usageDate: string, successAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE provider_usage SET last_success_at = ?, updated_at = ?
      WHERE provider = ? AND usage_date = ?
    `).bind(successAt, successAt, provider, usageDate).run();
  }

  async getProviderUsageSummary(provider: string, usageDate: string): Promise<{
    usedToday: number;
    lastFetchAt: string | null;
    lastSuccessAt: string | null;
    lastRequestSlot: string | null;
    lastRequestAt: string | null;
  }> {
    const row = await this.getProviderUsage(provider, usageDate);
    return {
      usedToday: row?.request_count ?? 0,
      lastFetchAt: row?.last_request_at ?? null,
      lastSuccessAt: row?.last_success_at ?? null,
      lastRequestSlot: row?.last_request_slot ?? null,
      lastRequestAt: row?.last_request_at ?? null,
    };
  }

  // ==================== Reset Cycle Helpers ====================

  /** Persist the DUE transition so confirmation mode survives worker restarts. */
  async advanceResetCycleState(now = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = 'DUE',
        due_at = COALESCE(due_at, ?),
        updated_at = ?
      WHERE status IN ('SCHEDULED', 'TIME_CHANGED')
        AND expected_reset_at IS NOT NULL
        AND julianday(expected_reset_at) <= julianday(?)
    `).bind(now, now, now).run();

    // Exact plans must also leave confirmation mode after a bounded period.
    // Otherwise one missed confirmation keeps the worker in the expensive
    // confirmation-search loop indefinitely.
    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = 'EXPIRED_UNCONFIRMED',
        due_at = COALESCE(due_at, expected_reset_at, ?),
        updated_at = ?
      WHERE status IN ('DUE', 'CONFIRMING')
        AND expected_reset_at IS NOT NULL
        AND julianday(expected_reset_at) < julianday(?, '-48 hours')
    `).bind(now, now, now).run();

    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = 'EXPIRED_UNCONFIRMED',
        due_at = COALESCE(due_at, ?),
        updated_at = ?
      WHERE status IN ('SCHEDULED', 'TIME_CHANGED')
        AND expected_reset_at IS NULL
        AND (
          COALESCE((
            SELECT MAX(julianday(COALESCE(lifecycle.published_at, lifecycle.created_at)))
            FROM monitor_events lifecycle
            WHERE lifecycle.id = reset_cycles.planned_event_id
               OR lifecycle.id = reset_cycles.time_changed_event_id
          ), julianday(reset_cycles.created_at)) < julianday(?, '-48 hours')
        )
    `).bind(now, now, now).run();
  }

  async getActiveResetCycle(options: { advance?: boolean } = {}): Promise<any | null> {
    // State advancement is explicit for read paths. Public status/health
    // endpoints are polled frequently and must not turn every read into three
    // UPDATE statements; Cron and /reset/current still advance state before
    // reading when they need a real-time transition.
    if (options.advance !== false) await this.advanceResetCycleState();
    return await this.db.prepare(`
      SELECT rc.*
      FROM reset_cycles rc
      LEFT JOIN monitor_events me ON me.id = rc.planned_event_id
      LEFT JOIN monitor_events te ON te.id = rc.time_changed_event_id
      WHERE rc.status IN ('SCHEDULED','DUE','CONFIRMING','TIME_CHANGED')
        AND rc.verification_status <> 'REJECTED'
        AND (
          rc.expected_reset_at IS NOT NULL
          OR COALESCE((
            SELECT MAX(julianday(COALESCE(lifecycle.published_at, lifecycle.created_at)))
            FROM monitor_events lifecycle
            WHERE lifecycle.id = rc.planned_event_id
               OR lifecycle.id = rc.time_changed_event_id
          ), julianday(rc.created_at)) >= julianday('now', '-48 hours')
        )
      ORDER BY CASE
        WHEN rc.expected_reset_at IS NOT NULL THEN julianday(rc.expected_reset_at)
        ELSE COALESCE((
          SELECT MAX(julianday(COALESCE(lifecycle.published_at, lifecycle.created_at)))
          FROM monitor_events lifecycle
          WHERE lifecycle.id = rc.planned_event_id
             OR lifecycle.id = rc.time_changed_event_id
        ), julianday(rc.created_at))
      END DESC, rc.id DESC
      LIMIT 1
    `).first();
  }

  /** Apply lifecycle events to the reset-cycle state machine. */
  async handleResetEvent(event: MonitorEvent): Promise<void> {
    if (!event.id) return;
    if (event.category === 'RESET_PLANNED') {
      await this.upsertResetCycleForEvent(event);
      return;
    }
    if (event.category === 'RESET_TIME_CHANGED') {
      await this.updateResetCycleTimeForEvent(event);
      return;
    }
    if (event.category === 'RESET_COMPLETED') {
      await this.completeResetCycleForEvent(event);
    }
  }

  private async updateResetCycleTimeForEvent(event: MonitorEvent): Promise<void> {
    const post = await this.getSourcePostById(event.source_post_id);
    const sourceAccount = post?.source_account ?? null;
    const cycle = await this.getActiveResetCycle();
    const now = new Date().toISOString();
    const nextExpectedAt = event.reset_at ?? event.effective_at ?? null;
    const incomingVerification = event.verification_status ?? 'DIRECT_VERIFIED';
    const appliedVerification = strongestVerification(cycle?.verification_status, incomingVerification);

    if (!cycle) {
      await this.db.prepare(`
        INSERT INTO reset_cycles
          (status, planned_event_id, expected_reset_at, expected_reset_time_text,
           is_approximate, time_confidence, time_changed_event_id,
           confirmation_type, reset_source, reset_source_url, verification_status)
        VALUES ('TIME_CHANGED', NULL, ?, NULL, ?, ?, ?, 'NONE', ?, ?, ?)
      `).bind(
        nextExpectedAt,
        nextExpectedAt ? 0 : 1,
        nextExpectedAt ? 'MEDIUM' : 'LOW',
        event.id,
        sourceAccount,
        event.source_url,
        appliedVerification
      ).run();
      return;
    }

    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = 'TIME_CHANGED',
        previous_expected_reset_at = expected_reset_at,
        expected_reset_at = ?,
        expected_reset_time_text = NULL,
        is_approximate = ?,
        time_confidence = ?,
        time_changed_event_id = ?,
        reset_source = COALESCE(?, reset_source),
        reset_source_url = ?,
        verification_status = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      nextExpectedAt,
      nextExpectedAt ? 0 : 1,
      nextExpectedAt ? 'MEDIUM' : 'LOW',
      event.id,
      sourceAccount,
      event.source_url,
      appliedVerification,
      now,
      cycle.id
    ).run();
  }

  private async completeResetCycleForEvent(event: MonitorEvent): Promise<void> {
    // An indexed search result is discovery evidence, not proof that the
    // reset actually completed. Keep any plan in its normal confirmation path
    // until a direct/official source verifies it.
    const indexedOnly = event.verification_status === 'INDEXED_ONLY'
      || event.source_quality === 'INDEXED'
      || event.evidence_quality === 'INDEXED';
    if (indexedOnly) return;

    const post = await this.getSourcePostById(event.source_post_id);
    const sourceAccount = post?.source_account ?? null;
    const now = new Date().toISOString();
    const confirmedAt = event.reset_at ?? event.effective_at ?? event.published_at ?? now;
    const confirmationType = event.verification_status === 'OFFICIAL_VERIFIED'
      || event.source_quality === 'OFFICIAL'
      || event.evidence_quality === 'OFFICIAL'
      ? 'OFFICIAL'
      : 'DIRECT';

    // Lifecycle handling may be retried after a worker timeout. If this event
    // was first indexed and later upgraded, promote that same historical row
    // rather than returning early or creating a duplicate standalone cycle.
    const alreadyLinked = await this.db.prepare(`
      SELECT id, status, confirmation_type, verification_status
      FROM reset_cycles
      WHERE completed_event_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(event.id).first<{
      id: number;
      status: string;
      confirmation_type: string | null;
      verification_status: string | null;
    }>();
    const incomingVerification = event.verification_status ?? 'DIRECT_VERIFIED';
    const linkedVerification = alreadyLinked
      ? strongestVerification(alreadyLinked.verification_status, incomingVerification)
      : incomingVerification;
    const linkedNeedsPromotion = !!alreadyLinked && (
      alreadyLinked.status !== 'CONFIRMED'
      || verificationRank(linkedVerification) > verificationRank(alreadyLinked.verification_status)
      || (confirmationType === 'OFFICIAL' && alreadyLinked.confirmation_type !== 'OFFICIAL')
    );

    if (alreadyLinked && !linkedNeedsPromotion) return;
    if (alreadyLinked) {
      await this.db.prepare(`
        UPDATE reset_cycles SET
          status = 'CONFIRMED',
          confirmation_type = ?,
          confirmation_confidence = ?,
          confirmed_reset_at = COALESCE(confirmed_reset_at, ?),
          confirmation_checked_at = ?,
          due_at = COALESCE(due_at, ?),
          reset_source = COALESCE(?, reset_source),
          reset_source_url = COALESCE(?, reset_source_url),
          verification_status = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        confirmationType,
        event.confidence,
        confirmedAt,
        now,
        confirmedAt,
        sourceAccount,
        event.source_url,
        linkedVerification,
        now,
        alreadyLinked.id
      ).run();
      return;
    }

    const cycle = await this.getActiveResetCycle();
    const cycleVerification = strongestVerification(cycle?.verification_status, incomingVerification);

    if (cycle) {
      await this.db.prepare(`
        UPDATE reset_cycles SET
          status = 'CONFIRMED',
          confirmation_type = ?,
          confirmation_confidence = ?,
          confirmed_reset_at = ?,
          confirmation_checked_at = ?,
          due_at = COALESCE(due_at, ?),
          reset_source = COALESCE(?, reset_source),
          reset_source_url = ?,
          completed_event_id = ?,
          verification_status = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        confirmationType,
        event.confidence,
        confirmedAt,
        now,
        confirmedAt,
        sourceAccount,
        event.source_url,
        event.id,
        cycleVerification,
        now,
        cycle.id
      ).run();
      return;
    }

    // A completion can arrive without a captured plan. Keep it as a
    // completed cycle rather than losing the lifecycle event entirely.
    await this.db.prepare(`
      INSERT INTO reset_cycles
        (status, planned_event_id, expected_reset_at, expected_reset_time_text,
         is_approximate, time_confidence, confirmation_type,
         confirmation_confidence, confirmed_reset_at, confirmation_checked_at,
         reset_source, reset_source_url, completed_event_id, verification_status,
         created_at, updated_at)
      VALUES ('CONFIRMED', NULL, NULL, NULL, 0, 'HIGH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      confirmationType,
      event.confidence,
      confirmedAt,
      now,
      sourceAccount,
      event.source_url,
      event.id,
      cycleVerification,
      now,
      now
    ).run();
  }

  async upsertResetCycleForEvent(event: MonitorEvent): Promise<void> {
    if (!event.id || event.category !== 'RESET_PLANNED') return;
    const post = await this.getSourcePostById(event.source_post_id);
    if (!post) return;

    const expectedAt = event.reset_at ?? event.effective_at ?? null;
    const staleApproximate = isStaleApproximateReset(expectedAt, event.published_at, event.created_at);
    const verification = event.verification_status ?? (
      post.source_quality === 'INDEXED'
        ? 'INDEXED_ONLY'
        : post.source_quality === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED'
    );
    const existing = await this.db.prepare(`
      SELECT id, verification_status FROM reset_cycles
      WHERE planned_event_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(event.id).first<{ id: number; verification_status: string | null }>();

    if (existing) {
      const appliedVerification = strongestVerification(existing.verification_status, verification);
      await this.db.prepare(`
        UPDATE reset_cycles SET
          status = CASE WHEN ? = 1 AND status IN ('SCHEDULED', 'TIME_CHANGED') THEN 'EXPIRED_UNCONFIRMED' ELSE status END,
          expected_reset_at = COALESCE(?, expected_reset_at),
          -- The source post is evidence, not a display-ready time label. Keep
          -- the approximate-time field empty until we have a dedicated,
          -- bounded extraction for it.
          expected_reset_time_text = NULL,
          is_approximate = ?,
          verification_status = ?,
          reset_source_url = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        staleApproximate ? 1 : 0,
        expectedAt,
        expectedAt ? 0 : 1,
        appliedVerification,
        event.source_url,
        new Date().toISOString(),
        existing.id
      ).run();
      return;
    }

    await this.db.prepare(`
      INSERT INTO reset_cycles
        (status, planned_event_id, expected_reset_at, expected_reset_time_text,
         is_approximate, time_confidence, confirmation_type, reset_source,
         reset_source_url, verification_status)
      VALUES (?, ?, ?, ?, ?, ?, 'NONE', ?, ?, ?)
    `).bind(
      staleApproximate ? 'EXPIRED_UNCONFIRMED' : 'SCHEDULED',
      event.id,
      expectedAt,
      null,
      expectedAt ? 0 : 1,
      expectedAt ? 'MEDIUM' : 'LOW',
      post.source_account,
      event.source_url,
      verification
    ).run();
  }

  async insertConfirmationEvidence(evidence: {
    reset_cycle_id: number;
    source_type: 'COMMUNITY' | 'OFFICIAL' | 'DIRECT';
    source_url: string;
    source_name?: string | null;
    source_author?: string | null;
    source_text?: string | null;
    published_at?: string | null;
    classification?: string;
  }): Promise<boolean> {
    const { meta } = await this.db.prepare(`
      INSERT OR IGNORE INTO reset_confirmation_evidence
        (reset_cycle_id, source_type, source_url, source_name, source_author,
         source_text, published_at, classification)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      evidence.reset_cycle_id,
      evidence.source_type,
      evidence.source_url,
      evidence.source_name ?? null,
      evidence.source_author ?? null,
      evidence.source_text ?? null,
      evidence.published_at ?? null,
      evidence.classification ?? null
    ).run();
    return meta.changes > 0;
  }

  async getConfirmationEvidence(resetCycleId: number): Promise<Array<{
    source_url: string;
    published_at: string | null;
    source_text: string | null;
  }>> {
    const { results } = await this.db.prepare(`
      SELECT source_url, published_at, source_text
      FROM reset_confirmation_evidence
      WHERE reset_cycle_id = ?
    `).bind(resetCycleId).all<{ source_url: string; published_at: string | null; source_text: string | null }>();
    return results;
  }

  async confirmResetCycle(resetCycleId: number, confirmedAt: string, confidence: number, evidenceCount: number): Promise<void> {
    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = 'CONFIRMED', confirmation_type = 'COMMUNITY',
        confirmation_confidence = ?, confirmed_reset_at = ?,
        confirmation_checked_at = ?, confirmation_evidence_count = ?,
        updated_at = ?
      WHERE id = ? AND status IN ('DUE','CONFIRMING')
        AND completed_event_id IS NULL
    `).bind(confidence, confirmedAt, confirmedAt, evidenceCount, confirmedAt, resetCycleId).run();
  }

  async markResetCycleConfirming(resetCycleId: number, checkedAt: string, evidenceCount: number): Promise<void> {
    await this.db.prepare(`
      UPDATE reset_cycles SET
        status = CASE WHEN status = 'DUE' THEN 'CONFIRMING' ELSE status END,
        confirmation_checked_at = ?, confirmation_evidence_count = ?, updated_at = ?
      WHERE id = ? AND status IN ('DUE','CONFIRMING')
        AND completed_event_id IS NULL
    `).bind(checkedAt, evidenceCount, checkedAt, resetCycleId).run();
  }

  // ==================== Health Check ====================

  async healthCheck(): Promise<boolean> {
    try {
      const row = await this.db
        .prepare('SELECT 1 as ok')
        .first<{ ok: number }>();
      return row?.ok === 1;
    } catch {
      return false;
    }
  }
}
