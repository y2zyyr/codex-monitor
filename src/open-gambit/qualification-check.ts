import { MockGambitProvider } from './llm';
import { runGambitStages } from './pipeline';
import { makeCandidateFromDecision, qualificationGate } from './policy';
import type { GambitAnalysis, GambitEvidence, GambitLLMResponse } from './types';

/** Fixed, side-effect-free staging acceptance. No DB, fetch, real provider,
 * Workflow dispatch, translation or publication is available to this harness. */
export async function runQualificationCheck() {
  const cases = [
    { name: 'routine-patch', fact: 'Updated bundled Claude CLI to version 2.1.259', outcome: 'LOW_STRATEGIC_VALUE', calls: 0 },
    { name: 'paid-to-free', fact: 'Previously paid Agent capability is now free.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'price-cut', fact: 'Company cuts API prices by 80%.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'protocol', fact: 'Company releases an interoperability protocol.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'default-model', fact: 'Cloud platform makes Model X the default model.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'open-weights', fact: 'Closed model is released as open weights.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'model-launch', fact: 'Company launches a new flagship model for developers.', outcome: 'AUTO_PUBLISH_ELIGIBLE', calls: 3 },
    { name: 'non-falsifiable', fact: 'Previously paid Agent capability is now free.', outcome: 'NON_FALSIFIABLE', calls: 3 },
    { name: 'political', fact: 'President announces an election campaign AI model.', outcome: 'POLITICAL_TOPIC_EXCLUDED', calls: 0 },
  ];
  const results = [];
  for (const fixture of cases) {
    const evidence: GambitEvidence = { sourceId: 'TEST_ONLY', title: fixture.fact, publisher: 'TEST_ONLY', publishedAt: '2026-09-07', snapshotId: 0, sourceTier: 'PRIMARY_OFFICIAL', canonicalUrl: 'https://example.com/TEST_ONLY', quote: fixture.fact, role: 'FACT', contentHash: 'a'.repeat(64) };
    const decision = qualificationGate({ headline: fixture.fact, summary: fixture.fact, content: fixture.fact, evidence: [evidence] });
    const candidate = makeCandidateFromDecision({ fingerprint: 'TEST_ONLY', headline: fixture.fact, summary: fixture.fact, canonicalUrl: evidence.canonicalUrl, snapshotIds: [0], sourceIds: ['TEST_ONLY'], decision, discoveredAt: '2026-09-07' });
    const analysis: GambitAnalysis = {
      decision: 'QUALIFIED', facts: [fixture.fact], evidenceIds: [], obviousLogic: 'The change lowers the cost of integration.',
      thesis: 'Lower integration cost can expand third-party distribution.', mechanism: 'Reducing integration friction lets independent developer tools add support without rebuilding their infrastructure.',
      beneficiaries: ['Developers'], pressuredActors: ['Competing platforms'], countercase: 'Independent developers may try the change without shipping integrations.', uncertainty: 'Adoption remains uncertain.',
      trajectories: [{ id: 'TEST_ONLY-integration', predictionStatement: fixture.name === 'non-falsifiable' ? 'This could strengthen the ecosystem.' : 'At least three independent developer tools will ship public integrations.', targetEntity: 'Third-party integrations', probability: 70, deadline: '2026-12-06', reasoning: 'Lower integration friction reduces the cost of adding support.', evidenceCriteria: 'Three independent repositories contain released integrations.', falsifier: 'Fewer than three independent tools have released integrations at the deadline.', status: 'WATCHING' }],
    };
    const provider = new MockGambitProvider(request => ({
      value: request.role === 'triage'
        ? { eventImportance: 0.8, aiTechRelevance: true, political: { excluded: false, reasons: [] }, evidenceSufficient: true, shouldDeepAnalysisRun: true }
        : request.role === 'gambit_analysis' ? analysis : { accepted: true, politicalFraming: false },
      provider: 'mock', modelId: 'TEST_ONLY', latencyMs: 0,
    } as GambitLLMResponse<never>));
    const result = await runGambitStages(candidate, [evidence], { providers: { triage: provider, gambit_analysis: provider, critic: provider }, now: new Date('2026-09-07') });
    const outcome = result.publicationDecision;
    const stages = provider.requests.map(request => request.role);
    const criticRequest = provider.requests.find(request => request.role === 'critic');
    const criticSawForecast = !criticRequest || (criticRequest.user.includes(analysis.mechanism) && criticRequest.user.includes(analysis.trajectories[0].predictionStatement));
    results.push({ name: fixture.name, earlyQualified: decision.qualified, detail: decision.substance.detail, signals: decision.substance.signalTypes, stages, outcome, politicalDecision: result.politicalDecision, passed: outcome === fixture.outcome && stages.length === fixture.calls && criticSawForecast });
  }
  return { passed: results.every(result => result.passed), realLlmCalls: 0, writes: 0, results };
}
