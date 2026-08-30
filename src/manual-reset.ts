import type { ManualResetReport, ManualResetReportPublic } from './types';

/** Keep Telegram identity and internal audit fields out of public responses. */
export function toPublicManualResetReport(
  report: ManualResetReport | null | undefined,
): ManualResetReportPublic | null {
  if (!report || report.status !== 'ACTIVE' || report.id === undefined) return null;

  return {
    id: report.id,
    resetAt: report.reset_at,
    reportedAt: report.reported_at,
    note: report.note,
    source: 'telegram_manual',
  };
}
