import type { ManualResetReport, MonitorEvent } from '../types';

/**
 * A manual report and a direct completion post can describe the same reset
 * incident even when the post was published shortly before the operator
 * reported it. Keep the matching window bounded so an old X event cannot
 * hide a genuinely newer manual report.
 */
export const DIRECT_RESET_MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;

function timestampMs(value: string | null | undefined): number | null {
  if (!value || !value.trim()) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const parsed = new Date(sqliteUtc).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** Return true only for non-indexed, completed reset evidence. */
export function isDirectResetCompletion(event: MonitorEvent | null | undefined): boolean {
  if (!event || event.category !== 'RESET_COMPLETED') return false;
  if (event.verification_status === 'REJECTED' || event.verification_status === 'INDEXED_ONLY') return false;
  if (event.source_quality === 'INDEXED' || event.evidence_quality === 'INDEXED') return false;

  return event.verification_status === 'DIRECT_VERIFIED'
    || event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'DIRECT'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'DIRECT'
    || event.evidence_quality === 'OFFICIAL';
}

/**
 * Decide whether the direct X/official completion should replace a Telegram
 * report in public views. Discovery order wins when known; the bounded time
 * window covers posts published just before a manual report, including the
 * case where the X API discovers that post later.
 */
export function directResetSupersedesManualReport(
  directEvent: MonitorEvent | null | undefined,
  manualReport: ManualResetReport | null | undefined,
): boolean {
  if (!manualReport || !directEvent || !isDirectResetCompletion(directEvent)) return false;

  const observedAt = timestampMs(directEvent.observed_at);
  const reportedAt = timestampMs(manualReport.reported_at);
  if (observedAt !== null && reportedAt !== null && observedAt >= reportedAt) return true;

  const publishedAt = timestampMs(directEvent.published_at);
  const resetAt = timestampMs(manualReport.reset_at);
  return publishedAt !== null
    && resetAt !== null
    && Math.abs(publishedAt - resetAt) <= DIRECT_RESET_MATCH_WINDOW_MS;
}

/** Return the manual report only while no authoritative completion supersedes it. */
export function effectiveManualResetReport(
  manualReport: ManualResetReport | null | undefined,
  directEvent: MonitorEvent | null | undefined,
): ManualResetReport | null {
  if (!manualReport || directResetSupersedesManualReport(directEvent, manualReport)) return null;
  return manualReport;
}
