import { describe, expect, it } from 'vitest';
import { gambitTranslationValidationErrors, translationRequest } from '../src/open-gambit/publication';
import { getGambitModelRoleConfig } from '../src/open-gambit/llm';
import { GambitRunBudget } from '../src/open-gambit/budget';
import type { GambitPublicArticle } from '../src/open-gambit/types';

/**
 * Open Gambit — translation ARRAY-PARITY CONTRACT regression.
 *
 * THE DEFECT THIS PINS DOWN
 * -------------------------
 * Phase 1.7 measured the translation stage for the first time and found `es`
 * failing `TRANSLATION_SCHEMA_INVALID` on every attempt while `zh`/`ja` passed.
 * Field-level diagnostics showed the model returned a `facts` array of length 1
 * for an input of length 2, so the validator reported `FACTS_COUNT_OR_TYPE`.
 *
 * The cause was a CONTRACT MISMATCH, not a model or validator bug:
 *
 *  - `gambitTranslationValidationErrors` requires `facts`, `beneficiaries` and
 *    `pressuredActors` to have EXACTLY the input length;
 *  - but the prompt only stated that rule for `trajectories`, so the model
 *    merged a short fact while writing natural prose in the longer-prose
 *    locales and the locale failed.
 *
 * The fix tightened the PROMPT to state the invariant the validator already
 * enforced. It did NOT relax the validator, and nothing here is locale-specific
 * beyond the `es` case that was observed.
 *
 * These tests therefore assert the CONTRACT (prompt and validator agree), not
 * any particular prose, so they cannot be satisfied by rewording output.
 */

function article(overrides: Partial<GambitPublicArticle> = {}): GambitPublicArticle {
  return {
    articleId: 1,
    candidateId: 1,
    slug: 'parity-fixture',
    headline: 'A documented capability standard changes developer distribution',
    surfaceEvent: 'A primary source documents a capability standard for developers.',
    facts: [
      'The primary source documents a capability standard for developers.',
      'The standard lowers switching costs across tooling.',
    ],
    obviousLogic: 'Lower switching costs expand reachable distribution.',
    thesis: 'The standard is a distribution wedge across developer tooling.',
    mechanism: 'Interoperability lowers the cost of moving between implementations, which widens the reachable distribution for every adopter.',
    beneficiaries: ['Developers', 'Smaller vendors'],
    pressuredActors: ['Incumbents'],
    countercase: 'Adoption may remain limited despite the standard.',
    falsifier: 'A primary source states the standard was withdrawn.',
    uncertainty: 'Execution and adoption remain uncertain.',
    trajectories: [{
      id: 'T1',
      targetEntity: 'The standard',
      probability: 70,
      deadline: '2026-12-31',
      status: 'WATCHING',
      predictionStatement: 'The standard will be available to developers.',
      reasoning: 'The source documents availability work and a distribution incentive.',
      evidenceCriteria: 'A primary source confirms availability to developers.',
      falsifier: 'A primary source states the standard was cancelled.',
    }],
    evidence: [],
    politicalTopic: false,
    critic: {
      accepted: true, rejectionReasons: [], simplerExplanation: '', motiveConcern: false,
      causalConcern: false, politicalFraming: false, sensationalismConcern: false,
      falsifiabilityConcern: false, notes: '',
    },
    modelRoleProvenance: {},
    modelPromptVersion: 'test',
    aiDisclosureVersion: 'v1',
    draftVersion: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    status: 'DRAFT',
    modifiedAt: '2026-09-12T00:00:00.000Z',
    translations: {},
    ...overrides,
  } as GambitPublicArticle;
}

/** A structurally complete translation payload. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headline: 'Un estándar de capacidad documentado cambia la distribución para desarrolladores',
    surfaceEvent: 'Una fuente primaria documenta un estándar de capacidad para desarrolladores.',
    facts: [
      'La fuente primaria documenta un estándar de capacidad para desarrolladores.',
      'El estándar reduce los costes de cambio entre herramientas.',
    ],
    obviousLogic: 'Menores costes de cambio amplían la distribución alcanzable.',
    thesis: 'El estándar es una cuña de distribución en las herramientas para desarrolladores.',
    mechanism: 'La interoperabilidad reduce el coste de cambiar entre implementaciones, lo que amplía la distribución alcanzable.',
    beneficiaries: ['Desarrolladores', 'Proveedores pequeños'],
    pressuredActors: ['Titulares establecidos'],
    countercase: 'La adopción puede seguir siendo limitada.',
    falsifier: 'Una fuente primaria indica que el estándar se retiró.',
    uncertainty: 'La ejecución y la adopción siguen siendo inciertas.',
    trajectories: [{
      predictionStatement: 'El estándar estará disponible para desarrolladores.',
      reasoning: 'La fuente documenta trabajo de disponibilidad y un incentivo de distribución.',
      evidenceCriteria: 'Una fuente primaria confirma la disponibilidad para desarrolladores.',
      falsifier: 'Una fuente primaria indica que el estándar se canceló.',
    }],
    ...overrides,
  };
}

const PARITY_ARRAYS = ['facts', 'beneficiaries', 'pressuredActors'] as const;

describe('Open Gambit translation array-parity contract', () => {
  it('states the array-parity rule for every array the validator enforces, not just trajectories', () => {
    const request = translationRequest(article(), 'es');
    const system = request.system;

    // The validator enforces exact length parity on these four arrays. The
    // prompt must say so for ALL of them: stating it only for `trajectories` is
    // exactly the gap that made `es` fail with FACTS_COUNT_OR_TYPE.
    expect(system).toMatch(/EXACTLY the same number of elements/i);
    for (const field of [...PARITY_ARRAYS, 'trajectories']) {
      expect(system, `the prompt must name ${field} in the parity rule`).toContain(field);
    }
    // And it must forbid the specific behaviour that broke `es`: merging.
    expect(system).toMatch(/never merge, split, add, or omit/i);
  });

  it('REJECTS a facts array that does not match the input length', () => {
    const target = article();
    // This is the exact observed `es` failure shape: one fact instead of two.
    const errors = gambitTranslationValidationErrors(
      payload({ facts: ['Sólo un hecho traducido.'] }),
      'es',
      target,
    );
    expect(errors).toContain('FACTS_COUNT_OR_TYPE');
  });

  it('REJECTS parity violations on beneficiaries and pressuredActors too', () => {
    const target = article();
    expect(gambitTranslationValidationErrors(
      payload({ beneficiaries: ['Sólo uno'] }), 'es', target,
    )).toContain('BENEFICIARIES_COUNT_OR_TYPE');
    expect(gambitTranslationValidationErrors(
      payload({ pressuredActors: ['Uno', 'Dos'] }), 'es', target,
    )).toContain('PRESSURED_ACTORS_COUNT_OR_TYPE');
  });

  it('ACCEPTS a structurally complete Spanish translation', () => {
    // Proves the rule is about STRUCTURE, not about Spanish words: a correct
    // Spanish payload passes, so the fix did not require loosening anything.
    const target = article();
    const structural = gambitTranslationValidationErrors(payload(), 'es', target)
      .filter(error => !/(TARGET_LANGUAGE_DOMINANCE|CROSS_LANGUAGE_SENTENCE_CONTAMINATION|NATURALNESS)$/u.test(error));
    expect(structural).toEqual([]);
  });

  it('requires every prose field to be TRANSLATED, not copied verbatim', () => {
    // The second contract gap Phase 1.7 measured: the model echoed the English
    // headline verbatim inside otherwise Japanese prose, and the language-quality
    // rule correctly rejected the sentence as
    // CROSS_LANGUAGE_SENTENCE_CONTAMINATION. The prompt previously never said the
    // text had to be translated rather than copied.
    const request = translationRequest(article(), 'ja');
    expect(request.system).toMatch(/Translate EVERY prose field and EVERY array element/i);
    expect(request.system).toMatch(/do not copy a title, sentence, or phrase from the input verbatim/i);
    // It must still permit the proper nouns the rule is designed to tolerate,
    // so this is not a blanket ban on ASCII characters.
    expect(request.system).toMatch(/Reproduce product names, company names, acronyms and identifiers in their original form/i);
  });

  it('REJECTS prose that was copied instead of translated', () => {
    // Proves the gate still FIRES on the exact shape that was observed, so the
    // prompt fix cannot be mistaken for a guarantee that the gate was weakened.
    //
    // Note the two rules are locale-aware and catch different copies:
    //  - a LATIN target (`es`) rejects an all-English sentence for lacking
    //    TARGET_LANGUAGE_DOMINANCE;
    //  - a NON-LATIN target (`ja`) rejects a sentence whose target-script
    //    character count is outnumbered by copied ASCII words, which is
    //    CROSS_LANGUAGE_SENTENCE_CONTAMINATION.
    const target = article();

    const esCopied = {
      headline: 'GitHub AI Scan for pull request APIs in public preview',
      surfaceEvent: 'GitHub AI Scan for pull request APIs in public preview',
      facts: [
        'GitHub AI Scan for pull request APIs in public preview',
        'GitHub AI Scan for pull request APIs in public preview REST API',
      ],
      obviousLogic: 'GitHub AI Scan for pull request APIs in public preview',
      thesis: 'GitHub AI Scan for pull request APIs in public preview',
      mechanism: 'GitHub AI Scan for pull request APIs in public preview',
      beneficiaries: ['GitHub', 'Enterprise platform engineering teams'],
      pressuredActors: ['Standalone pull-request scanning vendors'],
      countercase: 'GitHub AI Scan for pull request APIs in public preview',
      falsifier: 'GitHub AI Scan for pull request APIs in public preview',
      uncertainty: 'GitHub AI Scan for pull request APIs in public preview',
      trajectories: [{
        predictionStatement: 'GitHub AI Scan for pull request APIs in public preview',
        reasoning: 'GitHub AI Scan for pull request APIs in public preview',
        evidenceCriteria: 'GitHub AI Scan for pull request APIs in public preview',
        falsifier: 'GitHub AI Scan for pull request APIs in public preview',
      }],
    };
    expect(gambitTranslationValidationErrors(esCopied, 'es', target))
      .toContain('ES_TARGET_LANGUAGE_DOMINANCE');

    // The measured `ja` shape: Japanese prose carrying the whole English title.
    // Same fully-copied payload; the non-Latin rule reports contamination.
    const jaCopied = esCopied;
    expect(gambitTranslationValidationErrors(jaCopied, 'ja', target))
      .toContain('JA_CROSS_LANGUAGE_SENTENCE_CONTAMINATION');
  });

  it('enforces parity for the default translation role budget, not a known-bad one', () => {
    // The 2,000-token default was measured as unusable (reasoning consumed the
    // whole budget, content came back empty on every locale). A deployment that
    // omits GAMBIT_MODEL_ROLES_JSON falls back to this value, so it must be safe.
    const roles = getGambitModelRoleConfig({ GAMBIT_LLM_MODEL: 'deepseek-flash', GAMBIT_LLM_PROVIDER: 'deepseek' });
    const translation = roles.find(role => role.role === 'translation')!;
    expect(translation.tokenBudget).toBe(4_000);
  });

  it('keeps the default translation quota above the worst case it must fund', () => {
    // Same invariant the deployment configs satisfy:
    //   quota >= locales x maxAttemptsPerLocale x roleBudget
    const LOCALES = 4;
    const MAX_ATTEMPTS_PER_LOCALE = 2;
    const budget = new GambitRunBudget({
      maxLlmCalls: 12, maxLlmTokens: 33_000,
      maxTranslationLlmCalls: 0, maxTranslationLlmTokens: 0,
      maxSearchRequests: 0, maxXRequests: 0, maxGithubRequests: 0, maxHttpRequests: 20,
    });
    const roles = getGambitModelRoleConfig({ GAMBIT_LLM_MODEL: 'deepseek-flash', GAMBIT_LLM_PROVIDER: 'deepseek' });
    const roleBudget = roles.find(role => role.role === 'translation')!.tokenBudget;
    expect(
      LOCALES * MAX_ATTEMPTS_PER_LOCALE * roleBudget,
      'the default translation quota must fund every locale attempt',
    ).toBeLessThanOrEqual(budget.limits.maxTranslationLlmTokens);
  });
});
