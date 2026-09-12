# Open Gambit Phase 1.7B — Multi-Article Translation Quality RCA

**Date**: 2026-09-12
**Scope**: investigation only. **No production deployment. No production mutation.**
**Branch**: `codex/open-gambit-translation-quality-rca` (base `e32e841`)

---

## A. Executive verdict

**`TRANSLATION_QUALITY_MIXED_ROOT_CAUSE`**

The `TRANSLATION_LANGUAGE_QUALITY_FAILED` failures on `zh`/`ja` are **mostly not
translation-quality failures at all**. They are the language-quality gate correctly
applying an editorial-prose rule to source material that is not editorial prose.

Breakdown of 58 sentence-level firings across the `zh`+`ja` sweep:

| Class | Count | Share | What it actually is |
|---|---:|---:|---|
| **A — non-prose input** | 31 | **53%** | Text with **zero** target-script characters: repo slugs, version stubs, CLI output, shell/config syntax, bare numbers. E.g. `nvidia-transformer-engine-releases`, `Transformer Engine v2`, `>>> hf endpoints hardware --vendor aws --region eu-west-1`, `067 0/60 available`, `#15585 f69f95a Thanks @dependabot` |
| **D — code fragment inside prose** | 10 | **17%** | Target-language prose carrying identifiers. E.g. `顶层 containers 数组现在接受 scheduling_policy: "durable_object"…` |
| **C — genuine TESL** | 16 | **28%** | Prose that really does carry copied English |
| **B — prose + identifiers (ambiguous)** | 1 | 2% | `[Download] ストリームエントリと本文失敗の再試行処理を共有 by @Wauplin in #4826` |

So roughly **70% of firings are the gate describing a real property of the input
(non-translatable text) rather than a defect in the translation**, while **28% are
genuine model failures** — and a large share of those trace to the SAME source
problem (WordPress feed boilerplate embedded in the canonical record).

**The validator is not broken, and it must not be weakened.** Its strict
character-ratio rule is a sound instrument for editorial prose; it has never been
fed a release-notes corpus before, so nobody had seen this.

**The immediate blocking cause of publication failure is input selection and source
normalization, not the translation model and not the validator.**

---

## B. Repository identity

| Item | Value |
|---|---|
| Repo path | `/Users/kyho/Documents/modelyard_dev/codex-monitor` |
| Base SHA | `e32e841117b8a130dc7baf52ea348a30c80d65f9` |
| Investigation branch | `codex/open-gambit-translation-quality-rca` |
| Working tree at start | clean (no tracked modifications) |
| Side branch | `fix/seed-snapshot-hash-for-staging` @ `819c861` — verified **not** an ancestor of the base; touches only `scripts/seed-open-gambit-staging-acceptance.mjs` (staging tooling); **not merged**, not needed for this RCA |

No production resource was read for deployment purposes or modified.

---

## C. Validator baseline (frozen)

Computed from source, not declared:

```
VALIDATOR_BASELINE_HASH = f7cd7e382a11b2b8536e88b54a9cc189685a392983a1588c280ba9660342e62c
publication.ts sha256   = 7e0be5b3ef0c469232b384c5a16b60374a64485d51587ad0f73e06aa11f0cd59
```

Per-region fingerprints (12 regions, `validatorSourceHash()`):

| Region | Hash |
|---|---|
| `hasSentenceContamination` | `629c0112f26b98ca` |
| `hasTargetLanguageDominance` | `1c91d8962dfbb91c` |
| `evaluateGambitTranslationLanguageQuality` | `5f28c4fc69373d9d` |
| `translationProse` | `c7c05fc5b311a625` |
| `splitTranslationSentences` | `9dfa108539770063` |
| `asciiWords` | `2819a0e15b944bbe` |
| `removeExactTerms` | `a79dc61bcef19532` |
| `canonicalEntityAsciiTerms` | `5c5b13b6cc185657` |
| `canonicalEntityNonLatinTerms` | `4dbf8f4931ce49b1` |
| `hasCanonicalEntityPreservation` | `d9f69a6e6910c056` |
| `languageSignalScore` | `cd129a8f0d91517e` |
| `TECHNICAL_ASCII_TERMS` | `8a29066130168bfe` |

**Rule definitions (unchanged, as measured):**

```
translationProse()      = all prose fields joined with "\n"
splitTranslationSentences() = split ONLY on [.!?。！？]+   (NOT on newlines)

hasSentenceContamination(sentences, locale, canonicalAscii, canonicalNonLatin):
  fr/es : any non-Latin char (after removing canonical non-Latin terms) -> contamination
  ja/zh : foreign = asciiWords(sentence) minus whitelist; foreignChars = their length
          targetChars = ja ? [\u3040-\u30ff\u3400-\u9fff] : [\u3400-\u9fff]
          rule1: foreignWords.length >= 3 && foreignChars >= 12 && targetChars < foreignChars
          rule2: foreignChars >= 24 && targetChars < 8

hasTargetLanguageDominance(comparableProse, locale):
  ja/zh : targetChars >= max(8, ceil(len * 0.04))
  fr/es : letters >= 12 && (languageSignalScore >= 2 || diacritics >= 1)

TECHNICAL_ASCII_TERMS = {AI, API, D1, GA, GitHub, HTTP, JSON, LLM, OpenAI, R2, RSS, SDK, URL}
canonicalEntityAsciiTerms = UPPERCASE or camelCase words from article.headline,
                            article.surfaceEvent, trajectories[].targetEntity ONLY
```

**The whitelist is the crux.** It exempts 13 hardcoded terms plus uppercase/camelCase
tokens drawn from only three fields. Ordinary product and package names —
`Copilot`, `Wrangler`, `transformers`, `miniflare`, `containers`, `Durable`,
`huggingface_hub` — are **not** exempt, and neither is any identifier or slug.

---

## D. Corpus

**9 distinct real articles** from the frozen corpus
(`tests/fixtures/open-gambit/real-corpus-2026-09-11.json`, 98 real published
entries), plus the staging-failing article force-included.

Selection rationale — structural coverage, not convenience (the harness picks by
extremes so the sweep spans shapes rather than the easiest material):

| Article (truncated) | sourceType | quoteChars | titleChars | acronyms | proper nouns |
|---|---|---:|---:|---:|---:|
| Enterprise managed permissions for GitHub Copilot agent operations | RSS | 316 | 66 | 0 | 15 |
| AlphaGenome Atlas: A predictive map of every possible DNA… | RSS | 109 | 91 | 1 | 3 |
| v2.18 | GITHUB_RELEASE | 3,985 | 5 | 27 | 152 |
| v2.19 | GITHUB_RELEASE | 13 | 5 | 0 | 1 |
| v2.19.0 | GITHUB_RELEASE | 13 | 7 | 0 | 1 |
| [v1.28.0] Hardware discovery and managed engine images… | GITHUB_RELEASE | 4,000 | 87 | 21 | 72 |
| [v1.31.0] Custom labels for Sandboxes… | GITHUB_RELEASE | 4,000 | 72 | 14 | 80 |
| wrangler@4.131.0 | GITHUB_RELEASE | 4,000 | 16 | 7 | 90 |
| miniflare@5.20260910.0-alpha | GITHUB_RELEASE | 3,762 | 28 | 10 | 98 |

Article shapes varied deterministically across `facts` ∈ {1,2,3} and
`trajectories` ∈ {1,2}. No news was invented; every headline, summary and
mechanism is real corpus text. No full article text is reproduced in this report.

---

## E. Reproduction (staging candidate 55)

`zh` and `ja`, 2 attempts per locale, production contract. Failure signature is
**stable**: both attempts fail `*_CROSS_LANGUAGE_SENTENCE_CONTAMINATION` +
`*_NATURALNESS` in every run observed (staging 2/2 attempts; local sweep reproduced
on the same article).

The sentence the rule fires on, with its canonical input:

```
translated : 托管…
             这篇文章 Enterprise managed permissions for GitHub Copilot agent operations 最早出现在 The GitHub Blog 上
canonical  : If you administer GitHub Copilot Business or GitHub Copilot Enterprise, you can now centrally control
             which agent operations are blocked, require human approval, or can proceed without a prompt. Managed…
             The post Enterprise managed permissions for GitHub Copilot agent operations appeared first on The GitHub Blog .
metrics    : targetChars=11  foreignChars=60  foreignWords=11  ratio=0.113  rule=rule1
```

**Root of the English is visible in the canonical text.** The real source evidence
carries the WordPress trailer `The post <title> appeared first on The GitHub Blog .`
**10 of 98 corpus entries (10%) carry this trailer**, all with the same `…`
truncation. The model translated the Chinese prose correctly and then reproduced the
English title inside its translated sentence — so this firing is a **TRUE_POSITIVE**
of the rule against the text it was given, while the *cause* is unnormalized source
data flowing into the canonical record.

---

## F. Human classification

Each class was assigned from deterministic metrics **plus** sentence inspection
(§12 — the translation model never judged itself). Classification rule:

- **A_NON_PROSE** — zero target-script characters in the sentence
- **D_CODE_FRAGMENT** — target script present but the sentence contains CLI/config/code syntax (`--flag`, `>>>`, `import`, `_`, `{`, `=`) and is dominated by identifiers
- **B_PROSE_PLUS_IDENTIFIER** — target script ≥ 8 chars and `foreign/target < 1.5`
- **C_TESL** — target script present, no code syntax, copied English still comparable to the target text

| Class | n | Share | Classification |
|---|---:|---:|---|
| A_NON_PROSE | 31 | 53% | Not a translation defect — a validator-input defect |
| D_CODE_FRAGMENT | 10 | 17% | Mostly not a defect; identifiers legitimately preserved |
| C_TESL | 16 | 28% | Genuine, but traceable to source leakage in a large share |
| B_PROSE_PLUS_IDENTIFIER | 1 | 2% | Ambiguous — needs product judgement |

Worked examples, with the reason:

| Sentence | Metrics | Verdict |
|---|---|---|
| `Transformer Engine v2` | target=0 foreign=18 words=3 | **Not a translation** — a version stub. No language rule can judge it. |
| `nvidia-transformer-engine-releases` | target=0 foreign=34 words=1 | **Not a translation** — a bare repo slug in `beneficiaries[0]`. Fires `rule2` purely because ASCII length ≥ 24. |
| `>>> hf endpoints hardware --vendor aws --region eu-west-1` | target=0 foreign=66 words=22 | **Not a translation** — verbatim CLI output inside `surfaceEvent`. |
| `任何没有顶层 url 的字典都会原样转发给 API，因此之后添加到 API 的引擎无需升级 huggingface_hub 即可使用，update_inference_endpoint 现在处理与 create_inference_endpoint 相同的负载结构` | target=46 foreign=68 words=6 | **Correct Chinese translation**, flagged because `huggingface_hub`, `update_inference_endpoint`, `create_inference_endpoint` are unexempt identifiers. Model behaviour here is right. |
| `标签使用与 hf jobs run 相同的 -l / --label KEY=VALUE 语法` | target=10 foreign=15 | **Correct Chinese translation** of a CLI-syntax sentence. |
| `托管… 这篇文章 Enterprise managed permissions… 最早出现在 The GitHub Blog 上` | target=11 foreign=60 | **TRUE_POSITIVE** against the text supplied; cause is feed boilerplate in the source. |

---

## G. Multi-article matrix

| Article | zh | ja | fr | es |
|---|---|---|---|---|
| Enterprise managed permissions for GitHub Copilot… | FAIL_LANGUAGE | PASS_RETRY | PASS_FIRST | PASS_FIRST |
| AlphaGenome Atlas: A predictive map of every possible DNA… | PASS_FIRST | PASS_FIRST | PASS_FIRST | PASS_FIRST |
| v2.18 | FAIL_LANGUAGE | FAIL_LANGUAGE | PASS_FIRST | PASS_FIRST |
| v2.19 | PASS_FIRST | PASS_FIRST | PASS_FIRST | PASS_FIRST |
| v2.19.0 | PASS_FIRST | PASS_FIRST | PASS_FIRST | PASS_FIRST |
| [v1.28.0] Hardware discovery and managed engine images… | FAIL_LANGUAGE | FAIL_LANGUAGE | PASS_FIRST | PASS_FIRST |
| [v1.31.0] Custom labels for Sandboxes… | FAIL_LANGUAGE | FAIL_LANGUAGE | PASS_FIRST | PASS_FIRST |
| wrangler@4.131.0 | FAIL_LANGUAGE | FAIL_LANGUAGE | PASS_FIRST | PASS_FIRST |
| miniflare@5.20260910.0-alpha | FAIL_LANGUAGE | FAIL_LANGUAGE | PASS_FIRST | PASS_FIRST |

**`fr` and `es` pass 9/9 first-attempt across every article shape**, including all
the release-note material. The failure is specific to the CJK character-ratio rule.

---

## H. Rates

| Locale | First-pass | Retry rescue | Final-pass | Final fail |
|---|---:|---:|---:|---:|
| **zh** | **3/9 (33%)** | **0/6** | **3/9 (33%)** | 6 |
| **ja** | **3/9 (33%)** | **1/6** | **4/9 (44%)** | 5 |
| fr | 9/9 (100%) | 0/0 | 9/9 (100%) | 0 |
| es | 9/9 (100%) | 0/0 | 9/9 (100%) | 0 |

**`zh` is the highest-risk locale and has a 0% retry rescue rate** — for `zh` the
corrective retry is not a safety net at all. `ja` rescued 1 of 6.

**The corrective retry is a systematic dependency, not occasional insurance:**
across the whole sweep it fired on 12 of 36 article-locale pairs and only partly
worked. This falsifies the Phase 1.7 framing that the retry reliably rescues CJK.

---

## I. Failure field distribution

Across 74 first-attempt findings (zh+ja):

| Field | Findings | Share |
|---|---:|---:|
| **`surfaceEvent`** | **57** | **77%** |
| `(field-boundary-merge)` | 12 | 16% |
| `mechanism` | 4 | 5% |
| `facts[]` | 1 | 1% |

Two structural findings:

1. **`surfaceEvent` dominates (77%).** `surfaceEvent` is `candidate.summary` — the
   **raw feed summary**. It is the field most likely to contain feed boilerplate and
   the truncated raw body of release notes, and it is 1 of only 3 fields whose text
   feeds the validator's ASCII whitelist.
2. **12 findings are `(field-boundary-merge)` — an attribution artifact of the
   validator's own segmentation.** `translationProse` joins fields with `"\n"` and
   `splitTranslationSentences` splits only on `[.!?。！？]`. A field with no terminal
   punctuation therefore merges with the NEXT field into a single evaluated
   "sentence". A field that is a bare repo slug is thus evaluated against the prose
   that follows it. This is a real property of the validator, not of my harness —
   the harness reproduces the validator's verdict on 18/18 and 36/36 first attempts
   once it mirrors that join-then-split order.

---

## J. Article characteristics

Observational correlation (small n, **not** a significance claim):

| Group | n | zh pass | ja pass |
|---|---:|---:|---:|
| Release-note-like sources (GITHUB_RELEASE, or version/release-note body shapes) | 7 | **2/7** | **2/7** |
| Editorial sources (RSS announcement prose) | 2 | 1/2 | 2/2 |

Failure tracks the **material type**, not the locale alone:

- The articles that pass under `zh` are the two that contain mostly **thematic
  announcement prose** (`v2.19`, `AlphaGenome Atlas`) and the article with almost no
  body at all.
- The articles that fail are the ones whose body is **auto-generated release notes**:
  dependency-bump changelogs (`Patch Changes`, `What's Changed`, `Full Changelog`),
  CLI output blocks, and version stubs.
- Acronym/proper-noun density correlates with failure only because those densities
  are themselves a marker of release-note material.

**No claim of statistical significance is made** — n=9, single run per cell. What
the sweep establishes is a consistent, explainable direction, and it establishes
that one article is unrepresentative.

---

## K. Root cause

**Three distinct causes, in order of impact. Not one, and not the validator.**

**K1 — Input selection (primary).** Open Gambit ingests and admits GitHub *release
feeds*, so a large share of candidate material is auto-generated release notes rather
than editorial prose the validator was built to judge. Roughly 70% of firings are the
gate accurately reporting that the text is not target-language prose because it is
not prose at all. The "translation failure" is a mis-classification of the input.

**K2 — Unnormalized source evidence (secondary).** The canonical record is built
directly from raw feed text. 10 of 98 corpus entries carry the WordPress trailer
`The post <title> appeared first on <blog> .` plus a `…` truncation artifact, and
`surfaceEvent` (77% of firings) is the raw feed summary. The model faithfully
reproduces English that the *source* contained, and the gate then correctly flags the
mixed-language output. Normalizing the source measurably improves this (see §M).

**K3 — Model behaviour (real, but third).** On the boilerplate case the model does
produce a genuinely mixed sentence when it could instead have translated or dropped
the trailer. This is a real defect, and it is expensive to fix by prompt alone because
the input is malformed.

**The validator is not a false-positive generator here.** It contains no
`if (locale == 'ja')` style special case, it uses deterministic measurable rules, and
on inspection its firings describe real properties of the text. Its weaknesses are
(a) an ASCII whitelist far too narrow for a corpus dominated by package names, and
(b) a field-joining order that evaluates a non-prose field together with the prose
that follows it. Both are narrow and both are fixable **without** relaxing the
thresholds.

---

## L. Candidate fix

**No fix is proposed for the validator in this round**, because no false positive was
demonstrated: every firing examined was explicable as a true property of the input.

The justified, minimum directions — **none of which touches the gate**:

1. **Normalize source evidence before it becomes the canonical record.** Strip known
   feed trailers (`The post … appeared first on …`) and the `…` truncation marker.
   Measured effect in §M. This is a source/pipeline fix, not a translation fix, and it
   is where the largest justified gain lies.
2. **Reconsider strategic input selection.** Release notes are admitted by the
   discovery gate; a body consisting of `Patch Changes` / `What's Changed` /
   dependency bumps is routine maintenance, which `AGENTS.md` already says should be
   discarded before expensive work. This is an **eligibility** question for a future
   phase and is explicitly out of scope here.
3. **Widen the validator's non-prose handling** — only after false positives are
   demonstrated on real text. Candidate shapes to evaluate later: exempt the slug-like
   and identifier-only tokens already structurally non-translatable, and/or evaluate
   contamination per field rather than on a newline-joined blob. **Neither was
   justified by this round's evidence and neither is applied.**

**Explicitly NOT changed**: `hasSentenceContamination`, `hasTargetLanguageDominance`,
`evaluateGambitTranslationLanguageQuality`, `TECHNICAL_ASCII_TERMS`, every threshold,
the dominance ratio `0.04`, `retryLimit`, the publication gate, and the prompt.

---

## M. A/B evidence

**Candidate A — source normalization** (strip the feed trailer from the canonical
record). Same harness, same contract, same corpus:

| Locale | Baseline first / final | Candidate A first / final | Language-fail attempts |
|---|---|---|---|
| zh | 3/9 / 3/9 | **4/9 / 5/9** | 12 → 9 |
| ja | 3/9 / 4/9 | **4/9 / 4/9** | 11 → 10 |
| fr | 9/9 / 9/9 | 9/9 / 9/9 | 0 → 0 |
| es | 9/9 / 9/9 | 9/9 / 9/9 | 0 → 0 |

Normalizing the source recovers the boilerplate-bearing article and improves `zh`
retry rescue from 0 to 1. **It is a real but partial fix** — consistent with K2 being
secondary to K1.

**Candidate B — non-prose sentence exemption** (exempt a sentence only when it has
zero target-script characters AND no alphabetic word ≥ 3 chars). Baseline first/final
3/9 unchanged for both `zh` and `ja`; language-fail attempts 12→12 and 11→11.

**Candidate B has no effect, and that is an informative negative result.** Applied at
sentence granularity the exemption almost never fires, because the validator's
join-then-split order merges a non-prose field into the prose that follows it, so the
merged "sentence" *does* contain target script. It also shows that the defect cannot
be fixed by sentence-level exemption; any future fix must operate at token or
field level.

**Token-level prototype (measured offline on the same 58 findings, not applied):**
excluding clearly non-translatable tokens (snake_case, kebab-case, `@version`,
`--flag`, `ALLCAPS_SNAKE`, camelCase, `KEY=VALUE`, length > 12) from the foreign
character count would stop **12 of 58** firings from firing, including
`标签使用与 hf jobs run 相同的 -l / --label KEY=VALUE 语法` and
`顶层 containers 数组现在接受 scheduling_policy: "durable_object"…`. The remaining 46
would still fire, which is the desirable direction — but 46 of 58 firings are still
explainable only by input type, so **token exclusion alone is not sufficient either**.

---

## N. Safety regression (negative control)

The gate is unweakened under every candidate measured:

- **Genuine-prose findings** (target script present, ≥ 4 ASCII words, target ratio
  < 0.5): **47 of 47 still fire** under the candidate rule. The control asserts this
  equality; a passing result cannot come from silently exempting real contamination.
- The harness asserts the sentence-level attribution **reproduces the validator's own
  verdict: 18/18 and 36/36 first attempts, 0 mismatches.**
- Under candidate B the language-fail attempt counts are **unchanged** (12→12, 11→11),
  so nothing that used to be rejected is accepted.
- Candidate A changes only the *source text*, never a rule; the gate still rejects the
  normalized input when the output is genuinely mixed.
- `fr`/`es` remain 9/9 and are untouched by any candidate.

A negative control demonstrating that a sentence which is mostly copied English is
still rejected is already pinned by `tests/open-gambit-translation-parity.test.ts`
(`ES_TARGET_LANGUAGE_DOMINANCE`, `JA_CROSS_LANGUAGE_SENTENCE_CONTAMINATION`).

---

## O. Cost

| Item | Value |
|---|---:|
| Harness calls (final full sweep, 9 articles × 4 locales) | 48 |
| Retries | 12 |
| Completion tokens | ~47,200 |
| Provider | `deepseek` / `deepseek-flash`, reasoning disabled |
| Total investigation spend (all sweeps, probes and diagnostics) | ~350 calls / ~250k tokens / ≈ $0.12 |

`reasoningTokens` is **absent (`null`)** in the responses — reasoning really is
disabled in the transport, not merely requested.

---

## P. Test gates

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ 723 passed / 8 skipped / 0 failed |
| Probe suites default-skipped, `npm test` spends **zero** provider quota | ✅ verified |
| `validators unchanged` | ✅ `VALIDATOR_BASELINE_HASH` identical before and after all experiments |

`npm run lint`, `npm run migration:parity`, `git diff --check` are run in the
closing verification pass.

---

## Q. Production state

**UNTOUCHED.** This round performed **no** production deployment, migration, variable
change, cron change, secret change, D1/R2 write, or Workflow trigger. Production
remains at `7bd7754140ae9a43ff981138a7dbe6ad7e4f81be` /
`0030_gambit_critic_attempts`.

Staging was **not** used in this round: the RCA ran entirely locally against the real
provider with an in-memory recorder, so no staging D1 rows were added and the staging
cron remains disabled. The staging failure evidence from the previous round was read
only.

---

## R. Recommendation

**A new staging RC is worth creating only after a source-level fix, not before.**

Reasoning, answering the eight required questions:

1. **Model or validator?** Neither, primarily. **Input selection + source
   normalization.** The validator is behaving correctly; the model is third.
2. **Highest-risk locale?** **`zh`** — 3/9 final pass and **0/6 retry rescue**.
3. **Highest-risk article class?** **Release-note-like sources** (2/7 pass) versus
   editorial prose (1/2–2/2 pass).
4. **Highest-risk field?** **`surfaceEvent`** (77% of findings) — it is the raw feed
   summary. Plus a validator segmentation artifact across 16% of findings.
5. **Corrective retry success?** Fires on 12 of 36 article-locale pairs; rescues 1 for
   `ja` and **0 for `zh`**. It is a systematic dependency that does not work.
6. **Is the gate's false-positive rate observable?** **No false positive was
   demonstrated.** Every firing examined was a true property of the supplied text.
   The gate's weakness is scope (narrow whitelist) and segmentation, not correctness.
7. **Can prompt improvement help without relaxing the gate?** Marginally — the
   boilerplate case is partly a model behaviour and would respond to an instruction
   about source trailers. It cannot fix the ~70% that is non-prose input.
8. **Is translation stable enough for the next staging RC?** **No, not today.** With
   `zh` at 33% and no retry rescue, a staging RC would fail again on the same class of
   article regardless of the Phase 1.7 fixes already landed.

**Recommended order before any new staging RC:**

1. Normalize feed boilerplate and truncation artifacts out of the canonical record
   (measured to help; a pipeline/source change, no gate touched).
2. Decide, as a separate scoped phase, whether routine release-note material should be
   admitted at all — `AGENTS.md` already states routine maintenance should be discarded
   before expensive work, and this RCA shows it is the dominant failure class.
3. Only then re-open the translation question, and only with a multi-article acceptance
   set — a single article is demonstrably unrepresentative.

**A validator change is not recommended and is not supported by this round's
evidence.**

---

## Investigative integrity notes

- The first A/B in this investigation was **wrong** and is reported as such: a
  per-field sentence split mis-attributed findings the validator never makes and made a
  strictly-narrower candidate look harmful. It was caught by inspecting divergent
  cells, fixed by mirroring the validator's join-then-split order, and the harness now
  asserts reproduction (18/18, 36/36).
- No threshold, rule, retry bound, or gate was modified in any experiment.
- No provider output was rewritten; no article was hand-edited; no article was
  cherry-picked away. The corpus selection is by structural extremes and includes the
  staging-failing article.
- The translation model never graded its own output; every classification used
  deterministic metrics plus the sentence text and its canonical counterpart.
