/**
 * Open Gambit Phase 1.7 — staging end-to-end acceptance seed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Phase 1.7 staging acceptance run completed with `strategic_eligible = 0`:
 * 194 raw items -> 26 admitted -> 0 eligible -> 0 workflow dispatches. That is a
 * HEALTHY result (zero publication is a healthy outcome, and the gate was
 * verified correct by hand), but it means the run never executed a single LLM
 * call. The whole point of staging is to validate the real provider path, so a
 * zero-LLM run cannot discharge it.
 *
 * This script seeds ONE candidate so the Cloudflare Workflow can be triggered
 * once, end to end, against the real provider:
 *
 *   triage -> analysis -> critic (incl. the Phase 1.7 bounded re-sample)
 *          -> deterministic publication gate -> translation
 *
 * THE EVIDENCE IS REAL, NOT FABRICATED
 * ------------------------------------
 * The snapshot is a verbatim entry from the FROZEN Phase 1 corpus fixture
 * (`tests/fixtures/open-gambit/real-corpus-2026-09-11.json`) -- a real GitHub
 * Changelog announcement that Phase 1's T6 admitted and that Phase 1.7 T3
 * measured as `AUTO_PUBLISH_ELIGIBLE` 4/4 on the honest path. Nothing is
 * invented, and no `TEST_ONLY` marker is involved.
 *
 * SCOPE AND SAFETY
 * ----------------
 *  - STAGING ONLY. The database name is asserted against the staging database
 *    before any write; pointing this at production aborts.
 *  - It writes to the STAGING D1 only: two snapshot rows and one candidate row.
 *  - It does NOT trigger anything itself -- it prints the exact
 *    `wrangler workflows trigger` command for the operator to run, so the one
 *    expensive call stays a deliberate, separately-authorized act.
 *  - The seeded candidate is real evidence in an isolated staging database, so
 *    it is not `TEST_ONLY production content`.
 *
 * USAGE
 * -----
 *   set -a && . ../.env && set +a
 *   export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"
 *   node scripts/seed-open-gambit-staging-acceptance.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STAGING_DATABASE = 'codex-monitor-staging-db';
const STAGING_CONFIG = 'wrangler.staging.jsonc';
const CORPUS = fileURLToPath(new URL('../tests/fixtures/open-gambit/real-corpus-2026-09-11.json', import.meta.url));

const TARGET_TITLE = process.argv[2] || 'AI Scan for pull request APIs in public preview';
const SNAPSHOT_ID = Number(process.env.GAMBIT_ACCEPTANCE_SNAPSHOT_ID || 900001);

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/gu, "''")}'`;
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const entry = corpus.entries.find(item => item.title.toLowerCase() === TARGET_TITLE.toLowerCase())
  ?? corpus.entries.find(item => item.title.toLowerCase().includes(TARGET_TITLE.toLowerCase()));
if (!entry) throw new Error(`corpus entry not found: ${TARGET_TITLE}`);

// ---------------------------------------------------------------------------
// STAGING-ONLY GUARD, evaluated BEFORE any mutation.
//
// The guard must run before the write, not after: a check that only inspects the
// response cannot stop a write that has already been issued. The config is read
// from disk and its own D1 binding is asserted to be the staging database, and
// `wrangler.staging.jsonc` is likewise asserted to be the config in use, so a
// copy-paste of this script against a production config aborts here.
// ---------------------------------------------------------------------------
const configSource = readFileSync(new URL(`../${STAGING_CONFIG}`, import.meta.url), 'utf8');
if (!STAGING_DATABASE.includes('staging')) {
  throw new Error(`refusing to run: ${STAGING_DATABASE} is not a staging database`);
}
if (!/"name"\s*:\s*"codex-monitor-staging"/u.test(configSource)) {
  throw new Error(`refusing to run: ${STAGING_CONFIG} does not declare the staging Worker`);
}
if (!new RegExp(`"database_name"\\s*:\\s*"${STAGING_DATABASE}"`, 'u').test(configSource)) {
  throw new Error(`refusing to run: ${STAGING_CONFIG} does not bind ${STAGING_DATABASE}`);
}
if (/"database_name"\s*:\s*"codex-monitor-db"/u.test(configSource)) {
  throw new Error('refusing to run: the config binds the PRODUCTION database');
}

// A verbatim corpus entry, so the seeded evidence is real published source text.
const snapshot = {
  id: SNAPSHOT_ID,
  sourceId: entry.sourceId,
  requestedUrl: entry.url,
  finalUrl: entry.url,
  canonicalUrl: entry.url,
  title: entry.title,
  publisher: entry.sourceId,
  publishedAt: entry.publishedAt,
  retrievedAt: new Date().toISOString(),
  normalizedContent: entry.quote,
  contentHash: 'f'.repeat(64),
  extractorVersion: 'gambit-html-1',
  sourceQualityTier: entry.sourceTier,
};

const fingerprint = `phase17-staging-acceptance-${entry.sourceId}-${entry.title.slice(0, 40)}`;

const sql = [
  'DELETE FROM gambit_candidates WHERE fingerprint = ' + sqlLiteral(fingerprint) + ';',
  'DELETE FROM gambit_source_snapshots WHERE id = ' + SNAPSHOT_ID + ';',
  `INSERT INTO gambit_source_snapshots
     (id, source_id, requested_url, final_url, canonical_url, title, publisher, published_at,
      retrieved_at, normalized_content, content_hash, extractor_version, source_quality_tier, created_at)
   VALUES (${SNAPSHOT_ID}, ${sqlLiteral(snapshot.sourceId)}, ${sqlLiteral(snapshot.requestedUrl)},
      ${sqlLiteral(snapshot.finalUrl)}, ${sqlLiteral(snapshot.canonicalUrl)}, ${sqlLiteral(snapshot.title)},
      ${sqlLiteral(snapshot.publisher)}, ${sqlLiteral(snapshot.publishedAt)}, ${sqlLiteral(snapshot.retrievedAt)},
      ${sqlLiteral(snapshot.normalizedContent)}, ${sqlLiteral(snapshot.contentHash)},
      ${sqlLiteral(snapshot.extractorVersion)}, ${sqlLiteral(snapshot.sourceQualityTier)},
      ${sqlLiteral(snapshot.retrievedAt)});`,
  `INSERT INTO gambit_candidates
     (fingerprint, headline, summary, canonical_url, snapshot_ids_json, source_ids_json, political_topic,
      evidence_sufficient, strategic_value, falsifiable, status, discovered_at, updated_at)
   VALUES (${sqlLiteral(fingerprint)}, ${sqlLiteral(entry.title)}, ${sqlLiteral(entry.summary)},
      ${sqlLiteral(entry.url)}, ${sqlLiteral(JSON.stringify([SNAPSHOT_ID]))},
      ${sqlLiteral(JSON.stringify([entry.sourceId]))}, 0, 1, 0.9, 1, 'QUALIFIED',
      ${sqlLiteral(new Date().toISOString())}, ${sqlLiteral(new Date().toISOString())});`,
  `SELECT id, headline, status FROM gambit_candidates WHERE fingerprint = ${sqlLiteral(fingerprint)};`,
].join('\n');

const wrangler = ['wrangler', 'd1', 'execute', STAGING_DATABASE, '--remote', '--yes', '--config', STAGING_CONFIG, '--json', '--command', sql];
const raw = execFileSync('npx', wrangler, { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

const parsed = JSON.parse(raw.slice(raw.indexOf('[')));

const seeded = parsed?.[0]?.results?.find(row => row.headline);
console.log('seeded staging candidate:');
console.log(JSON.stringify(seeded ?? parsed?.[0]?.results, null, 2));
console.log('\nnow trigger ONE workflow run (separately authorized):');
console.log(`  npx wrangler workflows trigger gambit-analysis-staging '${JSON.stringify({
  workflowId: `gambit-analysis-candidate-${seeded?.id}`,
  candidateId: seeded?.id,
  snapshotIds: [SNAPSHOT_ID],
  startedAt: new Date().toISOString(),
})}' --config ${STAGING_CONFIG}`);
