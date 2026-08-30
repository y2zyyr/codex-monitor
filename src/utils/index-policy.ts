// ============================================================
// Event index eligibility
// ============================================================
// Verification quality and index eligibility are deliberately separate. An
// indexed-only event can be useful when it contains enough provenance and
// source text to be independently reviewed; a direct event can still be
// excluded when it is incomplete or too thin.

import type { MonitorEvent } from '../types';

export interface IndexEligibility {
  indexable: boolean;
  reasons: string[];
}

function hasText(value: string | null | undefined, minimumLength = 1): boolean {
  return typeof value === 'string' && value.trim().length >= minimumLength;
}

function hasProvenance(event: MonitorEvent): boolean {
  return event.source_post_id > 0
    && hasText(event.source_url)
    && hasText(event.first_discovered_via);
}

function hasMeaningfulContent(event: MonitorEvent): boolean {
  // The English and Chinese summaries are both rendered on the respective
  // localized pages. Keep the threshold intentionally modest: this is a
  // quality gate for empty records, not a keyword or word-count target.
  return hasText(event.title_en, 10)
    && hasText(event.title_zh, 2)
    && hasText(event.summary_en, 80)
    && hasText(event.summary_zh, 20);
}

export function evaluateEventIndexEligibility(event: MonitorEvent): IndexEligibility {
  const reasons: string[] = [];
  const status = event.verification_status || 'PENDING';
  const hasDate = hasText(event.published_at) || hasText(event.created_at);
  const hasCore = hasDate && hasProvenance(event) && hasMeaningfulContent(event);

  if (status === 'REJECTED') {
    return { indexable: false, reasons: ['rejected event'] };
  }
  if (!hasDate) reasons.push('missing published or record date');
  if (!hasProvenance(event)) reasons.push('incomplete provenance');
  if (!hasMeaningfulContent(event)) reasons.push('insufficient localized content');

  if (status === 'INDEXED_ONLY') {
    // Indexed evidence is not treated as direct verification. It may still
    // be indexable when the source excerpt and link make the record useful in
    // its historical context and the page clearly exposes its status.
    if (!hasText(event.source_text, 80)) reasons.push('indexed evidence has no usable source excerpt');
    if (!hasCore || !hasText(event.source_text, 80)) {
      return { indexable: false, reasons };
    }
    return { indexable: true, reasons: ['indexed evidence with source excerpt and historical context'] };
  }

  if (status !== 'DIRECT_VERIFIED' && status !== 'OFFICIAL_VERIFIED') {
    reasons.push('verification is pending or unknown');
    return { indexable: false, reasons };
  }

  return {
    indexable: hasCore,
    reasons: hasCore ? ['complete verified event record'] : reasons,
  };
}

export function isEventIndexEligible(event: MonitorEvent): boolean {
  return evaluateEventIndexEligibility(event).indexable;
}
