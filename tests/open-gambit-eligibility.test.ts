import { describe, expect, it } from 'vitest';
import matrix from './fixtures/open-gambit/early-qualification.json';
import patches from './fixtures/open-gambit/first-scheduled-run.json';
import { qualificationGate, makeCandidateFromDecision, deterministicPublicationGate } from '../src/open-gambit/policy';
import { runGambitStages } from '../src/open-gambit/pipeline';
import { MockGambitProvider } from '../src/open-gambit/llm';
import type { GambitEvidence, GambitAnalysis, GambitLLMResponse } from '../src/open-gambit/types';

function evidence(text: string): GambitEvidence {
  return { sourceId: 'test-official', title: text, publisher: 'TEST_ONLY', publishedAt: '2026-09-07', snapshotId: 1, sourceTier: 'PRIMARY_OFFICIAL', canonicalUrl: 'https://example.com/fact', quote: text, role: 'FACT', contentHash: 'a'.repeat(64) };
}
function gate(text: string, items = [evidence(text)]) {
  return qualificationGate({ headline: text, summary: text, content: text, evidence: items, falsifiable: false });
}
const analysis: GambitAnalysis = {
  decision: 'QUALIFIED', facts: ['Previously paid Agent capability is now free.'], evidenceIds: [1],
  obviousLogic: 'Free access lowers the entry cost.', thesis: 'Free access can convert integrations into distribution.',
  mechanism: 'Removing the entry charge lets developers integrate the Agent without procurement, expanding distribution.',
  countercase: 'Developers may try the capability without integrating it into production.', beneficiaries: ['Developers'], pressuredActors: ['Paid alternatives'], uncertainty: 'Integration is uncertain.',
  trajectories: [{ id: 'integration', predictionStatement: 'At least three independent developer tools will ship a public Agent integration.', targetEntity: 'Agent integrations', probability: 70, deadline: '2026-12-06', reasoning: 'Removing the charge lowers the cost of building integrations.', evidenceCriteria: 'Three independent tool repositories contain released Agent integrations.', falsifier: 'Fewer than three independent tools have released integrations at the deadline.', status: 'WATCHING' }],
};
const critic = { accepted: true, politicalFraming: false };

describe('early strategic qualification', () => {
  it.each(matrix)('$name: frozen golden matrix', row => {
    const decision = gate(row.text);
    expect(decision.qualified).toBe(row.eligible);
    expect(decision.reason).toBe(row.eligible ? null : 'LOW_STRATEGIC_VALUE');
    expect(decision.falsifiable).toBe(false);
  });
  it.each(patches)('real first-run $title still rejects without calls', async row => {
    const decision = gate(row.normalized_content);
    expect(decision.substance.detail).toBe('ROUTINE_MAINTENANCE');
    const candidate = makeCandidateFromDecision({ fingerprint: 'fixture', headline: row.title, summary: row.normalized_content, canonicalUrl: 'https://github.com/anthropics/claude-agent-sdk-python/releases/tag/' + row.title, snapshotIds: [row.id], sourceIds: ['anthropic-claude-agent-sdk-releases'], discoveredAt: '2026-09-07', decision });
    const provider = new MockGambitProvider(() => { throw new Error('No call allowed'); });
    const result = await runGambitStages(candidate, [evidence(row.normalized_content)], { providers: { triage: provider, gambit_analysis: provider, critic: provider } });
    expect(result.reason).toBe('LOW_STRATEGIC_VALUE');
    expect(provider.requests).toHaveLength(0);
  });
  it.each(['Fix typo in interoperability protocol release documentation.', 'chore: dependency bump for the new flagship model launch.', 'Add minor helper method for compatibility layer release.', 'Add MIME enum for Agent API.', 'Platform ecosystem default agent protocol pricing developer acquisition.', 'Our revolutionary AI platform will transform the ecosystem.'])('rejects noise or keyword stuffing: %s', text => {
    expect(gate(text).reason).toBe('LOW_STRATEGIC_VALUE');
  });
  it('cannot bypass evidence using a strategic headline, supplied score or discovery-only quote', () => {
    const text = 'Previously paid Agent capability is now free.';
    expect(gate(text, [{ ...evidence(text), sourceTier: 'DISCOVERY_ONLY' }]).reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(gate(text, [evidence('short')]).reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(qualificationGate({ headline: text, summary: text, content: text, evidence: [evidence('An ordinary dependency update for developers.')], strategicValue: 1, falsifiable: true }).reason).toBe('LOW_STRATEGIC_VALUE');
  });
  it('a separate material event survives mixed maintenance notes', () => {
    expect(gate('Fix typo in docs. Previously paid Agent capability is now free.').qualified).toBe(true);
  });
  it('political exclusion still has priority', () => {
    const decision = gate('President announces an election campaign AI model.');
    expect(decision.reason).toBe('POLITICAL_TOPIC_EXCLUDED');
    expect(decision.politicalReasons.length).toBeGreaterThan(0);
  });
  it('all major golden scenarios enter triage and analysis but do not force a thesis', async () => {
    for (const row of matrix.filter(item => item.eligible)) {
      const decision = gate(row.text);
      const candidate = makeCandidateFromDecision({ fingerprint: 'fixture', headline: row.text, summary: row.text, canonicalUrl: 'https://example.com/fact', snapshotIds: [1], sourceIds: ['test-official'], discoveredAt: '2026-09-07', decision });
      const provider = new MockGambitProvider(request => ({ value: request.role === 'triage' ? { eventImportance: 0.8, aiTechRelevance: true, political: { excluded: false, reasons: [] }, evidenceSufficient: true, shouldDeepAnalysisRun: true } : { decision: 'NO_GAMBIT_WORTH_PUBLISHING', reason: 'No defensible forecast.' }, provider: 'mock', modelId: 'TEST_ONLY', latencyMs: 0 } as GambitLLMResponse<never>));
      const result = await runGambitStages(candidate, [evidence(row.text)], { providers: { triage: provider, gambit_analysis: provider } });
      // Phase 1 (T2) added ONE bounded analysis re-sample when the model answers
      // NO_GAMBIT, because the stage samples and Phase 0 measured ~50% flipping
      // on identical input. The invariant this test protects is unchanged --
      // every golden scenario reaches analysis, and nothing downstream (critic,
      // composition) runs without a usable thesis -- so the retry is asserted as
      // BOUNDED rather than forbidden.
      const roles = provider.requests.map(request => request.role);
      expect(roles[0]).toBe('triage');
      expect(roles.slice(1).every(role => role === 'gambit_analysis')).toBe(true);
      expect(roles.filter(role => role === 'gambit_analysis').length).toBeLessThanOrEqual(2);
      expect(roles).not.toContain('critic');
      expect(result.status).toBe('NO_GAMBIT');
      expect(result.analysisAttempts).toBe(1);
    }
  });
});

describe('final thesis falsifiability', () => {
  const finalGate = (value: GambitAnalysis) => deterministicPublicationGate({ politicalTopic: false }, value, critic, new Date('2026-09-07'));
  it('permits a concrete forecast only after the final gate', () => {
    expect(finalGate(analysis).decision).toBe('AUTO_PUBLISH_ELIGIBLE');
  });
  it.each([
    { ...analysis, trajectories: [] },
    { ...analysis, trajectories: [{ ...analysis.trajectories[0], deadline: '' }] },
    { ...analysis, trajectories: [{ ...analysis.trajectories[0], deadline: '2026-01-01' }] },
    { ...analysis, trajectories: [{ ...analysis.trajectories[0], falsifier: '' }] },
    { ...analysis, trajectories: [{ ...analysis.trajectories[0], predictionStatement: 'This could strengthen the ecosystem.' }] },
    { ...analysis, trajectories: [{ ...analysis.trajectories[0], falsifier: analysis.trajectories[0].evidenceCriteria }] },
  ])('rejects an untestable final trajectory %#', value => {
    expect(finalGate(value).decision).toBe('NON_FALSIFIABLE');
  });
  it('requires the mechanism, countercase and critic approval', () => {
    expect(finalGate({ ...analysis, mechanism: '' }).decision).not.toBe('AUTO_PUBLISH_ELIGIBLE');
    expect(finalGate({ ...analysis, countercase: '' }).decision).not.toBe('AUTO_PUBLISH_ELIGIBLE');
    expect(deterministicPublicationGate({ politicalTopic: false }, analysis, { ...critic, accepted: false }).decision).not.toBe('AUTO_PUBLISH_ELIGIBLE');
  });
});

import openGambitApi from '../src/routes/open-gambit';
import { runQualificationCheck } from '../src/open-gambit/qualification-check';

it('fixed deployed harness verifies the complete intended stage path', async () => {
  const result = await runQualificationCheck();
  expect(result.passed).toBe(true);
  expect(result.realLlmCalls).toBe(0);
  expect(result.writes).toBe(0);
});
it('staging harness is unavailable in production', async () => {
  const response = await openGambitApi.request('/qualification-check', {}, { BUILD_ENVIRONMENT: 'production' });
  expect(response.status).toBe(404);
});
it('staging harness returns deployed provenance and bounded results', async () => {
  const response = await openGambitApi.request('/qualification-check', {}, { BUILD_ENVIRONMENT: 'staging', BUILD_SHA: 'fixture-sha' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ buildSha: 'fixture-sha', passed: true, realLlmCalls: 0, writes: 0 });
});

it('requires a real critic stage and honors semantic falsifiability concerns', async () => {
  const text = 'Previously paid Agent capability is now free.';
  const candidate = makeCandidateFromDecision({ fingerprint: 'fixture', headline: text, summary: text, canonicalUrl: 'https://example.com/fact', snapshotIds: [1], sourceIds: ['test-official'], discoveredAt: '2026-09-07', decision: gate(text) });
  const provider = new MockGambitProvider(request => ({ value: request.role === 'triage' ? { eventImportance: 0.8, aiTechRelevance: true, political: { excluded: false, reasons: [] }, evidenceSufficient: true, shouldDeepAnalysisRun: true } : request.role === 'critic' ? { accepted: false, falsifiabilityConcern: true } : analysis, provider: 'mock', modelId: 'TEST_ONLY', latencyMs: 0 } as GambitLLMResponse<never>));
  const absent = await runGambitStages(candidate, [evidence(text)], { providers: { triage: provider, gambit_analysis: provider }, now: new Date('2026-09-07') });
  expect(absent.status).toBe('FAILED');
  expect(absent.reason).toBe('PROVIDER_UNAVAILABLE');
  const rejected = await runGambitStages(candidate, [evidence(text)], { providers: { triage: provider, gambit_analysis: provider, critic: provider }, now: new Date('2026-09-07') });
  expect(rejected.publicationDecision).toBe('NON_FALSIFIABLE');
  expect(rejected.draft).toBeUndefined();
});
