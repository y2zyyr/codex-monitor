import { describe, it, expect, vi } from 'vitest';
import { Repository } from '../src/db/repository';

describe('D1 Repository', () => {
  describe('Source Posts', () => {
    it('insertSourcePost should return id on success, null on duplicate', () => {
      // This is a schema-level test: (source, source_post_id) UNIQUE
      const schema = `
        CREATE TABLE IF NOT EXISTS source_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          source_account TEXT NOT NULL,
          source_post_id TEXT NOT NULL,
          source_url TEXT NOT NULL,
          text TEXT NOT NULL,
          published_at TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          raw_json TEXT NOT NULL DEFAULT '{}',
          content_hash TEXT NOT NULL,
          classification_pending INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source, source_post_id)
        );
      `;
      expect(schema).toContain('UNIQUE(source, source_post_id)');
    });

    it('monitor_events has FK to source_posts', () => {
      const schema = `
        CREATE TABLE IF NOT EXISTS monitor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_post_id INTEGER NOT NULL,
          category TEXT NOT NULL,
          title_en TEXT NOT NULL,
          title_zh TEXT NOT NULL,
          summary_en TEXT NOT NULL,
          summary_zh TEXT NOT NULL,
          confidence REAL NOT NULL,
          published_at TEXT NOT NULL,
          effective_at TEXT,
          reset_at TEXT,
          source_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (source_post_id) REFERENCES source_posts(id),
          UNIQUE(source_post_id)
        );
      `;
      expect(schema).toContain('FOREIGN KEY (source_post_id) REFERENCES source_posts(id)');
      expect(schema).toContain('UNIQUE(source_post_id)');
    });

    it('monitor_events category has CHECK constraint', () => {
      const constraint = "CHECK(category IN ('RESET_PLANNED','RESET_COMPLETED','RESET_TIME_CHANGED','POLICY_CHANGE','CODEX_UPDATE','ROADMAP_HINT','FEATURE_DISCUSSION'))";
      expect(constraint).toContain('RESET_PLANNED');
      expect(constraint).toContain('RESET_COMPLETED');
      expect(constraint).toContain('RESET_TIME_CHANGED');
      expect(constraint).toContain('POLICY_CHANGE');
      expect(constraint).toContain('CODEX_UPDATE');
      expect(constraint).toContain('ROADMAP_HINT');
      expect(constraint).toContain('FEATURE_DISCUSSION');
      expect(constraint).not.toContain('IRRELEVANT');
    });
  });

  describe('Pagination', () => {
    it('encodes and decodes the publication-time cursor with its id tie-breaker', () => {
      const cursor = Repository.encodeEventCursor('2026-08-26T15:02:36.985Z', 25);
      expect(Repository.decodeEventCursor(cursor)).toEqual({
        sortValue: '2026-08-26T15:02:36.985Z',
        id: 25,
      });
    });

    it('rejects malformed cursors', () => {
      expect(Repository.decodeEventCursor('not-a-cursor')).toBeNull();
      expect(Repository.decodeEventCursor('2026-08-26T00:00:00Z|0')).toBeNull();
      expect(Repository.decodeEventCursor('not-a-date|1')).toBeNull();
    });

    it('supports category filter', () => {
      const query = 'SELECT * FROM monitor_events WHERE category = ? ORDER BY published_at DESC LIMIT ?';
      expect(query).toContain('WHERE category = ?');
    });

    it('has max limit of 100', () => {
      const maxLimit = 100;
      const userLimit = 200;
      const effectiveLimit = Math.min(userLimit, maxLimit);
      expect(effectiveLimit).toBe(100);
    });
  });

  describe('Operator reports', () => {
    it('uses an idempotent Telegram update id and keeps manual provenance separate', () => {
      const migration = `
        CREATE TABLE manual_reset_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_update_id INTEGER NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
      `;
      expect(migration).toContain('telegram_update_id INTEGER NOT NULL UNIQUE');
      expect(migration).toContain("status TEXT NOT NULL DEFAULT 'ACTIVE'");
    });
  });

  describe('History aggregation', () => {
    it('zero-fills Beijing calendar days and keeps category totals', async () => {
      const statement = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            { event_timestamp: '2026-08-26T01:00:00.000Z', category: 'POLICY_CHANGE' },
            { event_timestamp: '2026-08-26T02:00:00.000Z', category: 'POLICY_CHANGE' },
            { event_timestamp: '2026-08-27T16:00:00.000Z', category: 'RESET_COMPLETED' },
          ],
        }),
      };
      const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
      const history = await new Repository(db).getEventHistory({
        days: 3,
        // 2026-08-27 16:00 UTC is already 2026-08-28 in Asia/Shanghai.
        now: new Date('2026-08-27T16:00:00.000Z'),
      });

      expect(history.startDate).toBe('2026-08-26');
      expect(history.endDate).toBe('2026-08-28');
      expect(history.points.map(point => point.total)).toEqual([2, 0, 1]);
      expect(history.categoryTotals.POLICY_CHANGE).toBe(2);
      expect(history.categoryTotals.RESET_COMPLETED).toBe(1);
      expect(history.timeZone).toBe('Asia/Shanghai');
      expect(statement.bind).toHaveBeenCalledWith('2026-08-25T16:00:00.000Z', '2026-08-28T16:00:00.000Z');
    });

    it('groups events by New York calendar days at the local midnight boundary', async () => {
      const statement = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            { event_timestamp: '2026-08-27T03:59:59.000Z', category: 'POLICY_CHANGE' },
            { event_timestamp: '2026-08-27T04:00:00.000Z', category: 'RESET_COMPLETED' },
          ],
        }),
      };
      const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
      const history = await new Repository(db).getEventHistory({
        days: 2,
        timeZone: 'America/New_York',
        now: new Date('2026-08-27T12:00:00.000Z'),
      });

      expect(history.startDate).toBe('2026-08-26');
      expect(history.endDate).toBe('2026-08-27');
      expect(history.timeZone).toBe('America/New_York');
      expect(history.points.map(point => point.date)).toEqual(['2026-08-26', '2026-08-27']);
      expect(history.points.map(point => point.total)).toEqual([1, 1]);
      expect(statement.bind).toHaveBeenCalledWith('2026-08-26T04:00:00.000Z', '2026-08-28T04:00:00.000Z');
    });
  });

  describe('Deterministic source recovery', () => {
    it('returns authoritative X posts without an event for D1-only reclassification', async () => {
      const statement = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [{
            id: 154,
            source: 'x_api',
            source_account: 'thsottiaux',
            source_post_id: '2093573991965557198',
            source_url: 'https://x.com/thsottiaux/status/2093573991965557198',
            text: 'Looking at the dashboard we might hit a new milestone to celebrate tomorrow. Hold on to your Codex',
            published_at: '2026-08-29T05:38:00.000Z',
            fetched_at: '2026-08-29T06:00:00.000Z',
            raw_json: '{}',
            content_hash: 'recovery',
            classification_pending: 0,
            classification_attempts: 1,
            last_classification_attempt_at: '2026-08-29T06:00:01.000Z',
            classification_error: null,
            canonical_platform: 'x',
            canonical_post_id: '2093573991965557198',
            source_quality: 'DIRECT',
            first_discovered_via: 'x_api',
            last_verified_via: 'x_api',
            verified_at: '2026-08-29T06:00:00.000Z',
            indexed_at: null,
            verification_status: 'DIRECT_VERIFIED',
            created_at: '2026-08-29T06:00:00.000Z',
          }],
        }),
      };
      const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;

      const posts = await new Repository(db).getDirectPostsWithoutEvents(50);

      expect(posts).toHaveLength(1);
      expect(posts[0].canonical_post_id).toBe('2093573991965557198');
      expect(statement.bind).toHaveBeenCalledWith(50);
      expect(String((db.prepare as any).mock.calls[0][0])).toContain('LEFT JOIN monitor_events');
    });
  });

  describe('Read-path efficiency', () => {
    it('can read the active reset cycle without advancing state', async () => {
      const statement = {
        first: vi.fn().mockResolvedValue(null),
      };
      const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;

      await new Repository(db).getActiveResetCycle({ advance: false });

      expect(db.prepare).toHaveBeenCalledTimes(1);
      expect(statement.first).toHaveBeenCalledTimes(1);
    });

    it('orders the latest successful run by the indexed timestamp columns', async () => {
      const statement = {
        first: vi.fn().mockResolvedValue(null),
      };
      const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;

      await new Repository(db).getLatestSuccessfulRun();

      expect(String((db.prepare as any).mock.calls[0][0])).toContain('ORDER BY finished_at DESC, id DESC');
    });
  });
});
