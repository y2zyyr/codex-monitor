// ============================================================
// Open Gambit V1 - isolated domain types
// ============================================================

export const GAMBIT_SOURCE_TYPES = [
  'RSS',
  'ATOM',
  'OFFICIAL_BLOG',
  'OFFICIAL_PRODUCT',
  'GITHUB_RELEASE',
  'SEARCH',
  'X_DISCOVERY',
] as const;
export type GambitSourceType = typeof GAMBIT_SOURCE_TYPES[number];

export const GAMBIT_SOURCE_TIERS = [
  'PRIMARY_OFFICIAL',
  'PRIMARY_REPOSITORY',
  'PRIMARY_DOCUMENTATION',
  'SECONDARY_HIGH_QUALITY',
  'DISCOVERY_ONLY',
] as const;
export type GambitSourceTier = typeof GAMBIT_SOURCE_TIERS[number];

export const GAMBIT_CANDIDATE_STATUSES = [
  'DISCOVERED',
  'DUPLICATE',
  'REJECTED',
  'QUALIFIED',
  'ANALYZING',
  'DRAFTED',
  'WAITING_FOR_REVIEW',
  'APPROVED',
  'PUBLISHED',
] as const;
export type GambitCandidateStatus = typeof GAMBIT_CANDIDATE_STATUSES[number];

export const GAMBIT_ARTICLE_STATUSES = [
  'DRAFT',
  'WAITING_FOR_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'NEEDS_REANALYSIS',
] as const;
export type GambitArticleStatus = typeof GAMBIT_ARTICLE_STATUSES[number];

export const GAMBIT_REJECTION_REASONS = [
  'NO_GAMBIT_WORTH_PUBLISHING',
  'INSUFFICIENT_EVIDENCE',
  'POLITICAL_TOPIC_EXCLUDED',
  'DUPLICATE',
  'LOW_STRATEGIC_VALUE',
  'NON_FALSIFIABLE',
  'UNSUPPORTED_MOTIVE',
  'NEEDS_HUMAN_REVIEW',
] as const;
export type GambitRejectionReason = typeof GAMBIT_REJECTION_REASONS[number];

export const GAMBIT_PUBLICATION_DECISIONS = [
  'AUTO_PUBLISH_ELIGIBLE',
  'NO_GAMBIT_WORTH_PUBLISHING',
  'INSUFFICIENT_EVIDENCE',
  'POLITICAL_TOPIC_EXCLUDED',
  'DUPLICATE',
  'LOW_STRATEGIC_VALUE',
  'NON_FALSIFIABLE',
  'UNSUPPORTED_MOTIVE',
  'NEEDS_HUMAN_REVIEW',
] as const;
export type GambitPublicationDecision = typeof GAMBIT_PUBLICATION_DECISIONS[number];

export const GAMBIT_RESOLUTION_STATES = [
  'WATCHING',
  'DUE',
  'HIT',
  'PARTIAL',
  'MISS',
  'EXPIRED',
  'UNRESOLVED',
  'RETRACTED',
  'SUPERSEDED',
] as const;
export type GambitResolutionState = typeof GAMBIT_RESOLUTION_STATES[number];

export const GAMBIT_APPROVAL_ACTIONS = [
  'APPROVE',
  'REJECT',
  'RETURN_FOR_REANALYSIS',
] as const;
export type GambitApprovalAction = typeof GAMBIT_APPROVAL_ACTIONS[number];

export const GAMBIT_PROBABILITY_BUCKETS = [20, 30, 40, 50, 60, 70, 80] as const;
export type GambitProbability = typeof GAMBIT_PROBABILITY_BUCKETS[number];

export const GAMBIT_PIPELINE_STAGES = [
  'DETERMINISTIC_GATE',
  'TRIAGE',
  'ANALYSIS',
  'CRITIC',
  'COMPOSITION',
  'TRANSLATION',
  'RESOLUTION',
] as const;
export type GambitPipelineStage = typeof GAMBIT_PIPELINE_STAGES[number];

export const GAMBIT_PUBLIC_AI_IDENTITIES = ['Claude Fable 5', 'GPT-5.6 Sol', 'DeepSeek V4 Pro'] as const;
export type GambitPublicAiIdentity = typeof GAMBIT_PUBLIC_AI_IDENTITIES[number];

export const GAMBIT_LOCALES = ['en', 'zh', 'ja', 'fr', 'es'] as const;
export type GambitLocale = typeof GAMBIT_LOCALES[number];
export type GambitTranslationState = 'TRANSLATION_READY' | 'TRANSLATION_FAILED' | 'CANONICAL_FALLBACK';

export const GAMBIT_POLITICAL_DECISION_SOURCES = [
  'DETERMINISTIC_POLICY',
  'LLM_TRIAGE',
  'HYBRID',
] as const;
export type GambitPoliticalDecisionSource = typeof GAMBIT_POLITICAL_DECISION_SOURCES[number];

/**
 * The only political decision shape allowed to cross the triage/gate
 * boundary.  `reasons` is deliberately a short taxonomy, never model
 * chain-of-thought, and `decisionSource` records which layer made the call.
 */
export interface GambitPoliticalDecision {
  excluded: boolean;
  reasons: string[];
  confidence: number | null;
  decisionSource: GambitPoliticalDecisionSource;
}

export interface GambitSourceDefinition {
  id: string;
  name: string;
  type: GambitSourceType;
  url: string;
  publisher: string;
  qualityTier: GambitSourceTier;
  enabled: boolean;
  allowedHosts: string[];
  /** Optional source-specific parser hint. It is never taken from fetched text. */
  feedUrl?: string;
  notes?: string;
}

export interface GambitSourceSnapshot {
  id?: number;
  sourceId: string;
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  normalizedContent: string;
  contentHash: string;
  extractorVersion: string;
  sourceQualityTier: GambitSourceTier;
  r2Key?: string | null;
  retentionUntil?: string | null;
  createdAt?: string;
}

export interface GambitCandidate {
  id?: number;
  fingerprint: string;
  headline: string;
  summary: string;
  canonicalUrl: string;
  snapshotIds: number[];
  sourceIds: string[];
  politicalTopic: boolean;
  politicalReasons: string[];
  politicalDecisionSource?: GambitPoliticalDecisionSource | null;
  politicalDecisionConfidence?: number | null;
  evidenceSufficient: boolean;
  strategicValue: number;
  falsifiable: boolean;
  status: GambitCandidateStatus;
  rejectionReason?: GambitRejectionReason | null;
  discoveredAt: string;
  updatedAt?: string;
}

export interface GambitEvidence {
  id?: number;
  snapshotId: number;
  sourceId: string;
  sourceTier: GambitSourceTier;
  canonicalUrl: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  quote: string;
  role: 'FACT' | 'CONTEXT' | 'CORROBORATION';
  contentHash: string;
  createdAt?: string;
}

export interface GambitTriageResult {
  eventImportance: number;
  aiTechRelevance: boolean;
  /** Legacy wire field retained for compatibility with older providers. */
  politicsExcluded: boolean;
  /** Canonical political policy contract for new provider responses. */
  political?: GambitPoliticalDecision;
  evidenceSufficient: boolean;
  strategicMechanism: string | null;
  shouldDeepAnalysisRun: boolean;
  reason: string;
}

export interface GambitTrajectory {
  id: string;
  predictionStatement: string;
  targetEntity: string;
  probability: GambitProbability;
  deadline: string;
  reasoning: string;
  evidenceCriteria: string;
  falsifier: string;
  status: GambitResolutionState;
}

export interface GambitAnalysis {
  decision: 'QUALIFIED';
  facts: string[];
  evidenceIds: number[];
  obviousLogic: string;
  thesis: string;
  mechanism: string;
  beneficiaries: string[];
  pressuredActors: string[];
  countercase: string;
  trajectories: GambitTrajectory[];
  uncertainty: string;
}

export interface GambitNoGambitResult {
  decision: 'NO_GAMBIT_WORTH_PUBLISHING';
  reason: string;
}

export type GambitAnalysisResult = GambitAnalysis | GambitNoGambitResult;

export interface GambitCriticResult {
  accepted: boolean;
  rejectionReasons: string[];
  simplerExplanation: string;
  motiveConcern: boolean;
  causalConcern: boolean;
  politicalFraming: boolean;
  sensationalismConcern: boolean;
  falsifiabilityConcern: boolean;
  notes: string;
}

export interface GambitDraft {
  articleId?: number;
  candidateId: number;
  slug: string;
  headline: string;
  surfaceEvent: string;
  facts: string[];
  obviousLogic: string;
  thesis: string;
  mechanism: string;
  beneficiaries: string[];
  pressuredActors: string[];
  countercase: string;
  trajectories: GambitTrajectory[];
  falsifier: string;
  evidence: GambitEvidence[];
  uncertainty: string;
  politicalTopic: boolean;
  critic: GambitCriticResult;
  modelRoleProvenance: Record<string, GambitModelRoleProvenance>;
  modelPromptVersion: string;
  aiDisclosureVersion: string;
  draftVersion: number;
  createdAt: string;
}

export interface GambitPublicArticle extends GambitDraft {
  articleId: number;
  revisionId?: number;
  status: GambitArticleStatus;
  publishedAt: string | null;
  modifiedAt: string;
  translations: Partial<Record<GambitLocale, GambitTranslation>>;
  resolutionHistory?: GambitPublicResolutionEvent[];
  corrections?: GambitPublicCorrection[];
}

export interface GambitTranslation {
  locale: GambitLocale;
  headline: string;
  surfaceEvent: string;
  facts: string[];
  obviousLogic: string;
  thesis: string;
  mechanism: string;
  beneficiaries: string[];
  pressuredActors: string[];
  countercase: string;
  trajectories: GambitTrajectory[];
  falsifier: string;
  uncertainty: string;
  status: 'PENDING' | 'TRANSLATED' | 'FAILED';
  provider: string | null;
  translatedAt: string | null;
  /** Explicit public rendering state; never inferred from a missing row. */
  translationState?: GambitTranslationState;
  /** Canonical provenance carried through every locale rendering. */
  sourceIds?: string[];
  evidenceIds?: number[];
}

export interface GambitPublicResolutionEvent {
  id: number;
  trajectoryId: string;
  state: GambitResolutionState;
  evaluatorResult: GambitResolutionInput['evaluatorResult'];
  reviewState: GambitResolutionInput['reviewState'];
  explanation: string;
  evidenceIds: number[];
  supersededReason: string | null;
  createdAt: string;
}

export interface GambitPublicCorrection {
  id: number;
  predictionId: number | null;
  correctionType: 'CORRECTION' | 'RETRACTION' | 'SUPERSESSION';
  explanation: string;
  evidenceIds: number[];
  createdAt: string;
}

export interface GambitModelRoleConfig {
  role: string;
  /** Actual runtime provider selector/label; never derived from publicAiIdentity. */
  runtimeProvider: string;
  /** Actual runtime model ID, when configured; never derived from publicAiIdentity. */
  runtimeModelId: string | null;
  /** Visitor-facing presentation identity; it is not an API model ID. */
  publicAiIdentity: GambitPublicAiIdentity;
  timeoutMs: number;
  retryLimit: number;
  tokenBudget: number;
  fallbackRole?: string;
}

export interface GambitModelRoleProvenance {
  role: string;
  actualProvider: string;
  actualModelId: string | null;
  publicAiIdentity: GambitPublicAiIdentity;
  promptVersion: string;
  attemptId?: number;
}

export interface GambitLLMRequest {
  role: string;
  system: string;
  user: string;
  schemaName: string;
  tokenBudget: number;
  timeoutMs: number;
  retryLimit: number;
  /** Streaming is the default for analysis; translation may opt into a bounded JSON response. */
  stream?: boolean;
}

export interface GambitLLMResponse<T> {
  value: T;
  /** Actual adapter/provider provenance, not the visitor-facing identity. */
  provider: string;
  /** Actual model identifier returned or used by the adapter, when known. */
  modelId: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface GambitLLMProvider {
  readonly name: string;
  complete<T>(request: GambitLLMRequest): Promise<GambitLLMResponse<T>>;
}

export interface GambitWorkflowInput {
  workflowId: string;
  candidateId: number;
  snapshotIds: number[];
  startedAt?: string;
}

export interface GambitWorkflowResult {
  workflowId: string;
  status: 'NO_GAMBIT' | 'WAITING_FOR_REVIEW' | 'NEEDS_HUMAN_REVIEW' | 'FAILED' | 'COMPLETED';
  candidateId: number;
  publicationDecision?: GambitPublicationDecision;
  articleId?: number;
  revisionId?: number;
  reason?: string;
  draft?: GambitDraft;
}

export interface GambitResolutionInput {
  predictionId: number;
  state: GambitResolutionState;
  explanation: string;
  evidenceIds: number[];
  evaluatorResult: 'DETERMINISTIC' | 'PRIMARY_SOURCE' | 'SECONDARY_CORROBORATION' | 'LLM_INTERPRETATION' | 'HUMAN_REVIEW';
  reviewState: 'NOT_REQUIRED' | 'WAITING_FOR_REVIEW' | 'APPROVED';
  supersededReason?: string | null;
}

export interface GambitMetrics {
  discoveryRuns: number;
  sourcesFetched: number;
  fetchFailures: number;
  duplicates: number;
  politicalRejects: number;
  noGambitRejects: number;
  qualifiedGambits: number;
  workflowStarts: number;
  workflowFailures: number;
  humanApprovals: number;
  humanRejections: number;
  publications: number;
  predictions: number;
  dueResolutions: number;
  resolutionResults: number;
}

/**
 * Durable per-run discovery funnel (additive migration 0025). This is
 * observability for the broad-discovery redesign: it records how many sources
 * were attempted/succeeded/failed and how the cross-source candidate pool was
 * formed, deduplicated, ranked and capped before the expensive analysis path.
 * It deliberately never stores prompts, tokens, scores of individual
 * candidates, or internal error detail.
 */
export interface GambitDiscoveryStats {
  runId: number;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  rawItemsObserved: number;
  staleItems: number;
  malformedItems: number;
  admittedItems: number;
  exactDuplicates: number;
  routineNoiseRejects: number;
  strategicEligible: number;
  eventDuplicates: number;
  globalPoolSize: number;
  globalTopKSelected: number;
  workflowDispatches: number;
  workflowFailures: number;
  partialSourceFailure: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Public-facing "Latest Scan / Watching" summary. Only safe aggregates cross
 * the public boundary: no candidate ids, workflow ids, provider/model names,
 * token counts, prompts, scores, or internal error strings.
 */
export interface GambitLatestScan {
  hasRun: boolean;
  completedAt: string | null;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  sourcesChecked: number;
  itemsReviewed: number;
  candidatesReviewed: number;
  published: number;
  partialSourceFailure: boolean;
}
