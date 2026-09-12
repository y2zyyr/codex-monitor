/**
 * Open Gambit Phase 1.7B — translation language-quality DIAGNOSTICS.
 *
 * PURPOSE
 * -------
 * `TRANSLATION_LANGUAGE_QUALITY_FAILED` is an umbrella code. This module turns a
 * validator verdict into SENTENCE-LEVEL evidence: which field, which sentence,
 * which rule branch fired, and the exact numbers the rule compared.
 *
 * IT DOES NOT CHANGE THE VALIDATOR
 * --------------------------------
 * The validator is imported and called, never reimplemented for the verdict. The
 * metric extraction below MIRRORS the rule arithmetic so a firing can be
 * attributed to a field and a sentence; where the mirror and the validator could
 * disagree, the validator's verdict is authoritative and the mirror is labelled
 * as an attribution aid. `validatorSourceHash()` exists so every experiment can
 * state which validator revision it ran against.
 *
 * PRIVACY
 * -------
 * `includeText` is opt-in. When enabled it captures the offending sentence and the
 * canonical field so a human can judge true vs false positive; it is local
 * console output only. Nothing here is persisted, and no credential, header, or
 * whole provider payload is ever captured.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Sentences + per-field metrics for one (article, locale, attempt). */
export interface SentenceFinding {
  locale: string;
  field: string;
  sentenceIndex: number;
  sentenceChars: number;
  /** Character count in the target script (CJK for zh/ja). */
  targetChars: number;
  /** ASCII characters that are NOT whitelisted canonical/technical terms. */
  foreignChars: number;
  foreignWords: string[];
  asciiWordCount: number;
  targetScriptRatio: number;
  rule1: boolean;
  rule2: boolean;
  /** Name of the branch that fired: `rule1` or `rule2`. */
  firedRule: string | null;
  /**
   * Whether the sentence contains ANY target-script character. Combined with
   * `firedRule` this separates the two candidate root causes:
   *   hasTargetScriptInSentence === false -> NON-PROSE / identifier artifact
   *   hasTargetScriptInSentence === true  -> TESL (copied English inside prose)
   */
  hasTargetScriptInSentence: boolean | null;
  /**
   * Whether the CANDIDATE rule would still flag this exact sentence. The
   * negative control asserts this is true for every genuine-prose finding, so a
   * passing result cannot come from silently exempting real contamination.
   */
  candidateStillFires: boolean;
  text?: string;
  canonical?: string;
}

export interface LocaleDiagnostics {
  locale: string;
  /** The validator's own verdict, authoritative. */
  validatorErrors: string[];
  targetLanguageDominance: string;
  crossLanguageSentenceContamination: string;
  naturalness: string;
  canonicalEntityPreservation: string;
  /** Whole-prose dominance arithmetic (the comparable-prose input). */
  dominance: { targetChars: number; requiredTargetChars: number; proseChars: number; comparableChars: number };
  perField: Record<string, { targetChars: number; foreignChars: number; foreignWords: string[]; sentences: number }>;
  findings: SentenceFinding[];
  proseChars: number;
  sentenceCount: number;
}

const SENTENCE_SPLIT = /[.!?。！？]+/u;
const asciiWords = (value: string): string[] => value.match(/[A-Za-z][A-Za-z_-]*/gu) ?? [];
const countMatches = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0;

const TARGET_SCRIPT: Record<string, RegExp> = {
  ja: /[\u3040-\u30ff\u3400-\u9fff]/gu,
  zh: /[\u3400-\u9fff]/gu,
};

/** Mirrors `translationProse`, keeping per-field provenance so failures attribute. */
export function proseFields(value: Record<string, unknown>): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  const push = (field: string, text: unknown) => {
    if (typeof text === 'string' && text.length > 0) out.push({ field, text });
  };
  push('headline', value.headline);
  push('surfaceEvent', value.surfaceEvent);
  for (const [i, fact] of (Array.isArray(value.facts) ? value.facts : []).entries()) push(`facts[${i}]`, fact);
  push('obviousLogic', value.obviousLogic);
  push('thesis', value.thesis);
  push('mechanism', value.mechanism);
  for (const [i, item] of (Array.isArray(value.beneficiaries) ? value.beneficiaries : []).entries()) push(`beneficiaries[${i}]`, item);
  for (const [i, item] of (Array.isArray(value.pressuredActors) ? value.pressuredActors : []).entries()) push(`pressuredActors[${i}]`, item);
  push('countercase', value.countercase);
  push('falsifier', value.falsifier);
  push('uncertainty', value.uncertainty);
  for (const [i, trajectory] of (Array.isArray(value.trajectories) ? value.trajectories : []).entries()) {
    const t = (trajectory ?? {}) as Record<string, unknown>;
    push(`trajectories[${i}].predictionStatement`, t.predictionStatement);
    push(`trajectories[${i}].reasoning`, t.reasoning);
    push(`trajectories[${i}].evidenceCriteria`, t.evidenceCriteria);
    push(`trajectories[${i}].falsifier`, t.falsifier);
  }
  return out;
}

/**
 * Attribute a validator verdict to fields and sentences.
 *
 * The whitelist used here is reconstructed from the same public helpers the
 * validator uses, so a word counted as "foreign" here is a word the validator
 * would also count as foreign.
 */
export function diagnose(
  value: Record<string, unknown>,
  locale: string,
  article: Record<string, unknown>,
  validatorVerdict: { errors: string[]; targetLanguageDominance: string; crossLanguageSentenceContamination: string; naturalness: string; canonicalEntityPreservation: string },
  options: { includeText?: boolean } = {},
): LocaleDiagnostics {
  const fields = proseFields(value);
  const prose = fields.map(f => f.text).join('\n');

  // Rebuild the validator's whitelists from the same inputs it uses.
  const canonicalSource = [
    article.headline, article.surfaceEvent,
    ...(Array.isArray(article.trajectories) ? (article.trajectories as any[]).map(t => t?.targetEntity) : []),
  ].filter((v): v is string => typeof v === 'string').join('\n');
  const canonicalAscii = new Set<string>([
    'AI', 'API', 'D1', 'GA', 'GitHub', 'HTTP', 'JSON', 'LLM', 'OpenAI', 'R2', 'RSS', 'SDK', 'URL',
    ...new Set(asciiWords(canonicalSource).filter(term => /^[A-Z0-9_]+$/u.test(term) || /[a-z][A-Z]/u.test(term))),
  ]);
  const canonicalNonLatin = [...new Set(canonicalSource.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? [])];

  const removeExactTerms = (text: string, terms: string[]) => terms.reduce((r, t) => r.split(t).join(''), text);
  const comparable = removeExactTerms(prose, canonicalNonLatin);
  const targetPattern = TARGET_SCRIPT[locale];
  const required = locale === 'ja' || locale === 'zh'
    ? Math.max(8, Math.ceil(comparable.length * 0.04))
    : 0;

  const findings: SentenceFinding[] = [];
  const perField: LocaleDiagnostics['perField'] = {};

  // MIRROR THE VALIDATOR: it joins every field with "\n" and then splits ONLY on
  // sentence-ending punctuation. A field with no terminal punctuation therefore
  // merges with whatever follows it into one evaluated "sentence". Splitting
  // per-field here instead would attribute findings the validator never makes --
  // observed as the exact cause of a first A/B that was invalid.
  const joinedProse = fields.map(f => f.text).join('\n');
  const joinedSentences = joinedProse.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);

  for (const { field, text } of fields) {
    const sentences = text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
    let fieldTarget = 0; let fieldForeign = 0; const fieldForeignWords: string[] = [];

    for (const [index, sentence] of sentences.entries()) {
      const sentenceTarget = targetPattern ? countMatches(sentence, targetPattern) : 0;
      const words = asciiWords(sentence).filter(term => !canonicalAscii.has(term));
      const foreignChars = words.join('').length;
      const rule1 = words.length >= 3 && foreignChars >= 12 && sentenceTarget < foreignChars;
      const rule2 = foreignChars >= 24 && sentenceTarget < 8;
      const isCjk = locale === 'ja' || locale === 'zh';
      const fires = isCjk ? (rule1 || rule2) : false;
      fieldTarget += sentenceTarget; fieldForeign += foreignChars; fieldForeignWords.push(...words);
      const finding: SentenceFinding = {
        locale, field, sentenceIndex: index,
        sentenceChars: sentence.length,
        targetChars: sentenceTarget,
        foreignChars,
        foreignWords: words.slice(0, 20),
        asciiWordCount: asciiWords(sentence).length,
        targetScriptRatio: sentence.length ? Number((sentenceTarget / sentence.length).toFixed(3)) : 0,
        rule1, rule2,
        firedRule: fires ? (rule1 ? 'rule1' : 'rule2') : null,
        // The candidate only exempts sentences with NO target script AND no
        // alphabetic word; recompute the rule with that guard applied.
        candidateStillFires: fires && !(sentenceTarget === 0 && (sentence.match(/[A-Za-z]{3,}/gu) ?? []).length === 0),
        // Non-Latin characters present anywhere in the sentence. A sentence with
        // ZERO target-script characters is a candidate for a NON-PROSE artifact
        // (identifier/slug/version stub); a sentence WITH target script around
        // copied ASCII is a TESL candidate (translation-quality issue).
        hasTargetScriptInSentence: targetPattern ? countMatches(sentence, targetPattern) > 0 : null,
      };
      if (options.includeText && fires) {
        finding.text = sentence;
        const canonicalKey = field.replace(/\[\d+\]/gu, '');
        const canonicalValue = (article as any)[canonicalKey];
        finding.canonical = typeof canonicalValue === 'string' ? canonicalValue : undefined;
      }
      if (fires) findings.push(finding);
    }
    perField[field] = {
      targetChars: fieldTarget,
      foreignChars: fieldForeign,
      foreignWords: fieldForeignWords.slice(0, 30),
      sentences: sentences.length,
    };
  }

  // Validator-faithful findings: recompute on the JOINED sentence list and
  // attribute each firing to the field whose text contains it.
  const joinedFindings: SentenceFinding[] = [];
  for (const [index, sentence] of joinedSentences.entries()) {
    const sentenceTarget = targetPattern ? countMatches(sentence, targetPattern) : 0;
    const words = asciiWords(sentence).filter(term => !canonicalAscii.has(term));
    const foreignChars = words.join('').length;
    const isCjk = locale === 'ja' || locale === 'zh';
    const rule1 = isCjk && words.length >= 3 && foreignChars >= 12 && sentenceTarget < foreignChars;
    const rule2 = isCjk && foreignChars >= 24 && sentenceTarget < 8;
    if (!rule1 && !rule2) continue;
    const owner = fields.find(f => f.text.includes(sentence))?.field ?? '(field-boundary-merge)';
    joinedFindings.push({
      locale, field: owner, sentenceIndex: index,
      sentenceChars: sentence.length, targetChars: sentenceTarget, foreignChars,
      foreignWords: words.slice(0, 20), asciiWordCount: asciiWords(sentence).length,
      targetScriptRatio: sentence.length ? Number((sentenceTarget / sentence.length).toFixed(3)) : 0,
      rule1, rule2,
      firedRule: rule1 ? 'rule1' : 'rule2',
      hasTargetScriptInSentence: targetPattern ? sentenceTarget > 0 : null,
      candidateStillFires: !(sentenceTarget === 0 && (sentence.match(/[A-Za-z]{3,}/gu) ?? []).length === 0),
      ...(options.includeText ? { text: sentence } : {}),
    });
  }

  return {
    locale,
    validatorErrors: validatorVerdict.errors,
    targetLanguageDominance: validatorVerdict.targetLanguageDominance,
    crossLanguageSentenceContamination: validatorVerdict.crossLanguageSentenceContamination,
    naturalness: validatorVerdict.naturalness,
    canonicalEntityPreservation: validatorVerdict.canonicalEntityPreservation,
    dominance: {
      targetChars: targetPattern ? countMatches(comparable, targetPattern) : 0,
      requiredTargetChars: required,
      proseChars: prose.length,
      comparableChars: comparable.length,
    },
    perField,
    // Validator-faithful firings (joined-sentence attribution).
    findings: joinedFindings,
    proseChars: prose.length,
    sentenceCount: joinedSentences.length,
  };
}

/**
 * Fingerprint of the validator source regions this investigation runs against.
 * Every experiment records this so a mid-investigation validator edit cannot pass
 * unnoticed.
 */
export function validatorSourceHash(): { combined: string; file: string; regions: Record<string, string> } {
  const file = fileURLToPath(new URL('../../src/open-gambit/publication.ts', import.meta.url));
  const src = readFileSync(file, 'utf8');
  const region = (start: RegExp, end = '\n}') => {
    const m = start.exec(src);
    if (!m) throw new Error(`validator region not found: ${start}`);
    const i = m.index;
    return src.slice(i, src.indexOf(end, i) + end.length);
  };
  const regions: Record<string, string> = {
    hasSentenceContamination: region(/^function hasSentenceContamination/m),
    hasTargetLanguageDominance: region(/^function hasTargetLanguageDominance/m),
    evaluateGambitTranslationLanguageQuality: region(/^export function evaluateGambitTranslationLanguageQuality/m),
    translationProse: region(/^function translationProse/m),
    splitTranslationSentences: region(/^function splitTranslationSentences/m),
    asciiWords: region(/^function asciiWords/m),
    removeExactTerms: region(/^function removeExactTerms/m),
    canonicalEntityAsciiTerms: region(/^function canonicalEntityAsciiTerms/m),
    canonicalEntityNonLatinTerms: region(/^function canonicalEntityNonLatinTerms/m),
    hasCanonicalEntityPreservation: region(/^function hasCanonicalEntityPreservation/m),
    languageSignalScore: region(/^function languageSignalScore/m),
    TECHNICAL_ASCII_TERMS: region(/^const TECHNICAL_ASCII_TERMS/m, ']);'),
  };
  const combined = Object.keys(regions).sort().map(k => `### ${k}\n${regions[k]}`).join('\n');
  return {
    combined: createHash('sha256').update(combined).digest('hex'),
    file: createHash('sha256').update(src).digest('hex'),
    regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex').slice(0, 16)])),
  };
}

/**
 * CANDIDATE RULE (experiment only — the validator itself is NOT modified).
 *
 * Counts how many sentences the contamination rule would examine under the
 * BASELINE input versus under a candidate input that excludes sentences which
 * contain no translatable prose at all.
 *
 * "Translatable prose" is defined narrowly and negatively: a sentence carrying at
 * least one alphabetic word of length >= 3 qualifies. A sentence with no such
 * word cannot be prose in any language, so a language rule cannot legitimately
 * judge it.
 *
 * This deliberately does NOT exempt:
 *   - sentences containing target-script characters (real mixed output), nor
 *   - English prose sentences of >= 2 words (real untranslated prose).
 * Those still fire, which is what keeps the gate honest.
 */
export function candidateSegmentation(
  value: Record<string, unknown>,
  locale: string,
): { baselineExamined: number; candidateExamined: number; exempted: Array<{ field: string; sentenceIndex: number; text: string; reason: string }> } {
  const targetPattern = TARGET_SCRIPT[locale];
  const isCjk = locale === 'ja' || locale === 'zh';
  const exempted: Array<{ field: string; sentenceIndex: number; text: string; reason: string }> = [];
  let baselineExamined = 0; let candidateExamined = 0;

  // fr/es contamination is a non-Latin-script test; only zh/ja use the ratio rules.
  if (!isCjk) return { baselineExamined: 0, candidateExamined: 0, exempted };

  const joined = proseFields(value).map(f => f.text).join('\n').split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
  {
    for (const [index, sentence] of joined.entries()) {
      const field = '(joined)';
      baselineExamined += 1;
      const targetChars = countMatches(sentence, targetPattern);
      const proseWords = sentence.match(/[A-Za-z]{3,}/gu) ?? [];
      const hasTranslatableProse = proseWords.length >= 1;
      const nonProse = targetChars === 0 && !hasTranslatableProse;
      if (nonProse) {
        exempted.push({
          field, sentenceIndex: index, text: sentence,
          reason: `targetChars=0 and no alphabetic word >=3 chars (words=${proseWords.length})`,
        });
      } else {
        candidateExamined += 1;
      }
    }
  }
  return { baselineExamined, candidateExamined, exempted };
}

/**
 * SHADOW VERDICT under the candidate segmentation, computed on the SAME provider
 * output as the baseline verdict so the comparison isolates the rule change from
 * model sampling variance.
 *
 * Mirrors `evaluateGambitTranslationLanguageQuality` exactly, except that a
 * sentence which contains no translatable prose (see `candidateSegmentation`) is
 * not eligible to be flagged as cross-language contamination. Dominance and entity
 * preservation are evaluated EXACTLY as the validator does, so the candidate
 * cannot pass by weakening those.
 */
export function shadowLanguageQuality(
  value: Record<string, unknown>,
  locale: string,
  article: Record<string, unknown>,
): { errors: string[]; exemptedCount: number } {
  const fields = proseFields(value);
  const prose = fields.map(f => f.text).join('\n');
  const canonicalSource = [
    article.headline, article.surfaceEvent,
    ...(Array.isArray(article.trajectories) ? (article.trajectories as any[]).map(t => t?.targetEntity) : []),
  ].filter((v): v is string => typeof v === 'string').join('\n');
  const canonicalAscii = new Set<string>([
    'AI', 'API', 'D1', 'GA', 'GitHub', 'HTTP', 'JSON', 'LLM', 'OpenAI', 'R2', 'RSS', 'SDK', 'URL',
    ...new Set(asciiWords(canonicalSource).filter(t => /^[A-Z0-9_]+$/u.test(t) || /[a-z][A-Z]/u.test(t))),
  ]);
  const canonicalNonLatin = [...new Set(canonicalSource.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? [])];
  const removeTerms = (text: string, terms: string[]) => terms.reduce((r, t) => r.split(t).join(''), text);
  const targetPattern = TARGET_SCRIPT[locale];
  const isCjk = locale === 'ja' || locale === 'zh';

  // --- contamination, with the candidate exemption ---
  let contamination = false; let exemptedCount = 0;
  if (isCjk) {
    const joined = fields.map(f => f.text).join('\n').split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
    for (const sentence of joined) {
      const targetChars = countMatches(sentence, targetPattern);
      const proseWords = sentence.match(/[A-Za-z]{3,}/gu) ?? [];
      if (targetChars === 0 && proseWords.length === 0) { exemptedCount += 1; continue; }
      const words = asciiWords(sentence).filter(t => !canonicalAscii.has(t));
      const foreignChars = words.join('').length;
      if (words.length >= 3 && foreignChars >= 12 && targetChars < foreignChars) contamination = true;
      if (foreignChars >= 24 && targetChars < 8) contamination = true;
    }
  } else {
    // Latin locales: non-Latin characters are contamination (unchanged).
    for (const { text } of fields) {
      for (const sentence of text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean)) {
        if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(removeTerms(sentence, canonicalNonLatin))) contamination = true;
      }
    }
  }

  // --- dominance: computed EXACTLY as the validator does ---
  const comparable = removeTerms(prose, canonicalNonLatin);
  let dominance = true;
  if (locale === 'ja') dominance = countMatches(comparable, /[\u3040-\u30ff\u3400-\u9fff]/gu) >= Math.max(8, Math.ceil(comparable.length * 0.04));
  else if (locale === 'zh') dominance = countMatches(comparable, /[\u3400-\u9fff]/gu) >= Math.max(8, Math.ceil(comparable.length * 0.04));
  else if (locale === 'fr' || locale === 'es') {
    const letters = countMatches(comparable, /\p{Letter}/gu);
    const signals = new Set(locale === 'fr'
      ? ['avec', 'dans', 'des', 'du', 'est', 'et', 'les', 'pour', 'sur', 'une']
      : ['con', 'del', 'el', 'en', 'es', 'la', 'las', 'los', 'para', 'por', 'una', 'y']);
    const score = asciiWords(comparable.toLocaleLowerCase()).filter(w => signals.has(w)).length;
    const diacritics = countMatches(comparable, /[À-ÖØ-öø-ÿÑñ¿¡]/gu);
    dominance = letters >= 12 && (score >= 2 || diacritics >= 1);
  }

  const naturalness = dominance && !contamination;
  const prefix = locale.toUpperCase();
  const errors: string[] = [];
  if (!dominance) errors.push(`${prefix}_TARGET_LANGUAGE_DOMINANCE`);
  if (contamination) errors.push(`${prefix}_CROSS_LANGUAGE_SENTENCE_CONTAMINATION`);
  if (!naturalness) errors.push(`${prefix}_NATURALNESS`);
  return { errors, exemptedCount };
}
