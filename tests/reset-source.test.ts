import { describe, expect, it } from 'vitest';
import {
  DIRECT_RESET_MATCH_WINDOW_MS,
  directResetSupersedesManualReport,
  effectiveManualResetReport,
  isDirectResetCompletion,
} from '../src/utils/reset-source';
import type { ManualResetReport, MonitorEvent } from '../src/types';

function directEvent(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id: 43,
    source_post_id: 152,
    source_account: 'thsottiaux',
    category: 'RESET_COMPLETED',
    title_en: 'Tibo indicates Codex usage has reset',
    title_zh: 'Tibo表示Codex用户用量已重置',
    summary_en: 'The reset took effect.',
    summary_zh: '重置已经生效。',
    confidence: 0.82,
    published_at: '2026-08-27T16:35:05.000Z',
    effective_at: null,
    reset_at: null,
    source_url: 'https://x.com/thsottiaux/status/2093014447833116908',
    source_quality: 'DIRECT',
    evidence_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    observed_at: '2026-08-28T00:00:00.000Z',
    verified_at: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function manualReport(overrides: Partial<ManualResetReport> = {}): ManualResetReport {
  return {
    id: 1,
    telegram_update_id: 100,
    telegram_message_id: 10,
    telegram_user_id: '123456789',
    telegram_username: 'y2zyyr',
    telegram_display_name: 'yy22',
    telegram_chat_id: '987654321',
    reported_at: '2026-08-27T17:31:50.555Z',
    reset_at: '2026-08-27T17:31:50.555Z',
    note: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('reset evidence source precedence', () => {
  it('recognizes direct and official completion events but not indexed evidence', () => {
    expect(isDirectResetCompletion(directEvent())).toBe(true);
    expect(isDirectResetCompletion(directEvent({
      source_quality: 'INDEXED',
      evidence_quality: 'INDEXED',
      verification_status: 'INDEXED_ONLY',
    }))).toBe(false);
  });

  it('lets an X completion discovered after Telegram replace the manual report', () => {
    const report = manualReport();
    const discoveredLater = directEvent({ observed_at: '2026-08-27T18:00:00.000Z' });

    expect(directResetSupersedesManualReport(discoveredLater, report)).toBe(true);
    expect(effectiveManualResetReport(report, discoveredLater)).toBeNull();
  });

  it('matches a post published shortly before the manual report as the same reset incident', () => {
    const report = manualReport();
    const publishedBeforeReport = directEvent({
      observed_at: '2026-08-27T17:00:00.000Z',
      published_at: '2026-08-27T16:35:05.000Z',
    });

    expect(directResetSupersedesManualReport(publishedBeforeReport, report)).toBe(true);
  });

  it('does not let an old direct completion hide a later manual report', () => {
    const report = manualReport({
      reported_at: '2026-08-30T17:31:50.555Z',
      reset_at: '2026-08-30T17:31:50.555Z',
    });
    const oldEvent = directEvent({
      published_at: new Date(new Date(report.reset_at).getTime() - DIRECT_RESET_MATCH_WINDOW_MS - 1).toISOString(),
      observed_at: '2026-08-27T18:00:00.000Z',
    });

    expect(directResetSupersedesManualReport(oldEvent, report)).toBe(false);
    expect(effectiveManualResetReport(report, oldEvent)).toEqual(report);
  });
});
