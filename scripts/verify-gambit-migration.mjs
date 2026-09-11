import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const temp = mkdtempSync(join(tmpdir(), 'tibo-gambit-migration-'));
const state = join(temp, 'd1-state');
const databaseName = 'gambit-local-parity-db';

function run(args) {
  return execFileSync(process.execPath, [wrangler, ...args], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function query(sql) {
  const output = run(['d1', 'execute', databaseName, '--local', '--persist-to', state, '--json', '--command', sql]);
  const parsed = JSON.parse(output);
  if (!parsed?.[0]?.success) throw new Error(`Local D1 query failed: ${sql}`);
  return parsed[0].results ?? [];
}

function execute(sql) {
  run(['d1', 'execute', databaseName, '--local', '--persist-to', state, '--command', sql]);
}

function rejected(sql) {
  try {
    execute(sql);
    return false;
  } catch {
    return true;
  }
}

function verifyImmutability() {
  const now = '2026-09-04T00:00:00.000Z';
  execute(`
    INSERT INTO gambit_sources (id, name, source_type, url, publisher, quality_tier, allowed_hosts_json, enabled, notes, created_at, updated_at)
    VALUES ('immutability-test-source', 'TEST_ONLY', 'OFFICIAL_BLOG', 'https://example.com/test', 'TEST_ONLY', 'PRIMARY_OFFICIAL', '["example.com"]', 1, NULL, '${now}', '${now}');
    INSERT INTO gambit_source_snapshots (source_id, requested_url, final_url, canonical_url, title, publisher, published_at, retrieved_at, normalized_content, content_hash, extractor_version, source_quality_tier, r2_key, retention_until, created_at)
    VALUES ('immutability-test-source', 'https://example.com/test', 'https://example.com/test', 'https://example.com/test', 'TEST_ONLY', 'TEST_ONLY', '${now}', '${now}', 'TEST_ONLY evidence', '${'a'.repeat(64)}', 'gambit-test-1', 'PRIMARY_OFFICIAL', NULL, NULL, '${now}');
    INSERT INTO gambit_candidates (fingerprint, headline, summary, canonical_url, snapshot_ids_json, source_ids_json, political_topic, political_reasons_json, evidence_sufficient, strategic_value, falsifiable, status, rejection_reason, discovered_at, updated_at)
    VALUES ('${'b'.repeat(64)}', 'TEST_ONLY', 'TEST_ONLY', 'https://example.com/test', '[1]', '["immutability-test-source"]', 0, '[]', 1, 0.8, 1, 'QUALIFIED', NULL, '${now}', '${now}');
    INSERT INTO gambit_articles (candidate_id, slug, headline, surface_event, status, political_topic, no_trajectory_issued, current_revision_id, published_at, created_at, updated_at, ai_disclosure_version)
    SELECT id, 'immutability-test-article', 'TEST_ONLY', 'TEST_ONLY', 'WAITING_FOR_REVIEW', 0, 0, NULL, NULL, '${now}', '${now}', 'v1'
    FROM gambit_candidates WHERE fingerprint = '${'b'.repeat(64)}';
    INSERT INTO gambit_article_revisions (article_id, revision_number, draft_json, canonical_json, content_hash, model_prompt_version, status, created_at)
    SELECT id, 1, '{}', '{}', 'immutability-test-revision', 'gambit-prompts-v1', 'WAITING_FOR_REVIEW', '${now}'
    FROM gambit_articles WHERE slug = 'immutability-test-article';
    UPDATE gambit_articles
    SET current_revision_id = (SELECT id FROM gambit_article_revisions WHERE content_hash = 'immutability-test-revision')
    WHERE slug = 'immutability-test-article';
    INSERT INTO gambit_evidence (article_id, revision_id, snapshot_id, source_id, source_tier, canonical_url, title, publisher, published_at, quote, evidence_role, content_hash, created_at)
    SELECT a.id, r.id, s.id, s.source_id, 'PRIMARY_OFFICIAL', s.canonical_url, s.title, s.publisher, s.published_at, s.normalized_content, 'FACT', 'immutability-test-evidence', '${now}'
    FROM gambit_articles a JOIN gambit_article_revisions r ON r.article_id = a.id JOIN gambit_source_snapshots s ON s.source_id = 'immutability-test-source'
    WHERE a.slug = 'immutability-test-article';
    INSERT INTO gambit_predictions (article_id, revision_id, trajectory_id, original_prediction_statement, original_probability, original_target, original_observable_condition, original_deadline, original_reasoning, original_falsifier, original_publication_timestamp, original_model_prompt_version, original_content_hash, status, created_at)
    SELECT a.id, r.id, 'immutability-trajectory', 'TEST_ONLY prediction', 70, 'TEST_ONLY target', 'TEST_ONLY condition', '2026-12-31', 'TEST_ONLY reasoning', 'TEST_ONLY falsifier', '${now}', 'gambit-prompts-v1', 'immutability-test-prediction', 'WATCHING', '${now}'
    FROM gambit_articles a JOIN gambit_article_revisions r ON r.article_id = a.id WHERE a.slug = 'immutability-test-article';
    INSERT INTO gambit_resolution_events (prediction_id, state, evaluator_result, review_state, explanation, evidence_ids_json, superseded_reason, content_hash, created_at)
    SELECT id, 'MISS', 'HUMAN_REVIEW', 'APPROVED', 'TEST_ONLY initial resolution', '[]', NULL, 'immutability-test-resolution', '${now}'
    FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction';
    INSERT INTO gambit_corrections (article_id, prediction_id, correction_type, explanation, evidence_ids_json, content_hash, created_at)
    SELECT article_id, id, 'CORRECTION', 'TEST_ONLY initial correction', '[]', 'immutability-test-correction', '${now}'
    FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction';
  `);

  const prediction = `(SELECT id FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction')`;
  const resolution = `(SELECT id FROM gambit_resolution_events WHERE content_hash = 'immutability-test-resolution')`;
  const correction = `(SELECT id FROM gambit_corrections WHERE content_hash = 'immutability-test-correction')`;
  const attacks = [
    `UPDATE gambit_predictions SET original_probability = 20 WHERE id = ${prediction}`,
    `UPDATE gambit_predictions SET original_prediction_statement = 'tampered' WHERE id = ${prediction}`,
    `UPDATE gambit_predictions SET original_deadline = '2099-01-01' WHERE id = ${prediction}`,
    `UPDATE gambit_predictions SET original_reasoning = 'tampered' WHERE id = ${prediction}`,
    `UPDATE gambit_predictions SET status = 'HIT' WHERE id = ${prediction}`,
    `DELETE FROM gambit_resolution_events WHERE id = ${resolution}`,
    `UPDATE gambit_resolution_events SET state = 'HIT' WHERE id = ${resolution}`,
    `DELETE FROM gambit_corrections WHERE id = ${correction}`,
    `UPDATE gambit_corrections SET explanation = 'tampered' WHERE id = ${correction}`,
  ];
  const attackResults = attacks.map(rejected);

  execute(`
    INSERT INTO gambit_resolution_events (prediction_id, state, evaluator_result, review_state, explanation, evidence_ids_json, superseded_reason, content_hash, created_at)
    SELECT id, 'UNRESOLVED', 'HUMAN_REVIEW', 'APPROVED', 'TEST_ONLY appended resolution', '[]', NULL, 'immutability-test-resolution-2', '2026-09-05T00:00:00.000Z'
    FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction';
    INSERT INTO gambit_corrections (article_id, prediction_id, correction_type, explanation, evidence_ids_json, content_hash, created_at)
    SELECT article_id, id, 'RETRACTION', 'TEST_ONLY appended correction', '[1]', 'immutability-test-correction-2', '2026-09-05T00:00:00.000Z'
    FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction';
  `);
  const triggers = query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'gambit_%' ORDER BY name");
  return {
    triggers: triggers.map(row => row.name),
    attackCount: attacks.length,
    rejectedAttackCount: attackResults.filter(Boolean).length,
    appendOnlyWritesSucceeded: query("SELECT COUNT(*) AS count FROM gambit_resolution_events WHERE prediction_id = (SELECT id FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction')")[0]?.count === 2
      && query("SELECT COUNT(*) AS count FROM gambit_corrections WHERE prediction_id = (SELECT id FROM gambit_predictions WHERE original_content_hash = 'immutability-test-prediction')")[0]?.count === 2,
  };
}

try {
  writeFileSync(join(temp, 'wrangler.jsonc'), JSON.stringify({
    name: 'gambit-local-parity',
    compatibility_date: '2026-08-20',
    d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: '00000000-0000-0000-0000-000000000021' }],
  }));
  cpSync(join(root, 'migrations'), join(temp, 'migrations'), { recursive: true });
  run(['d1', 'migrations', 'apply', databaseName, '--local', '--persist-to', state]);
  const foreignKeys = query('PRAGMA foreign_key_check');
  const migrationRows = query("SELECT name FROM d1_migrations ORDER BY name");
  const gambitTables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'gambit_%' ORDER BY name");
  const indexes = query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_gambit_%' ORDER BY name");
  const immutability = verifyImmutability();
  const migrationFiles = readFileSync(join(root, 'migrations', '0021_open_gambit.sql'), 'utf8');
  const localeRows = query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'gambit_translations'")[0]?.sql ?? '';
  const localeMigration = readFileSync(join(root, 'migrations', '0023_gambit_translation_locales.sql'), 'utf8');
  const provenanceMigration = readFileSync(join(root, 'migrations', '0024_gambit_political_provenance.sql'), 'utf8');
  const candidateColumns = query("PRAGMA table_info(gambit_candidates)").map(row => row.name);
  // The bounded re-sample counters. 0027 (analysis), 0029 (triage) and 0030
  // (critic) each added one; `runQualifiedGambitWorkflow` writes them on every
  // outcome, including NO_GAMBIT and FAILED, so a missing column would turn a
  // lost candidate into an unreported one. The column names are read from a
  // fresh database, not assumed.
  const retryCounterColumns = ['analysis_attempts', 'triage_attempts', 'critic_attempts']
    .filter(name => candidateColumns.includes(name));
  const result = {
    overall: foreignKeys.length === 0 && migrationRows.some(row => row.name === '0021_open_gambit.sql') && migrationRows.some(row => row.name === '0023_gambit_translation_locales.sql') && migrationRows.some(row => row.name === '0024_gambit_political_provenance.sql') && gambitTables.length >= 15 && indexes.length >= 12 && migrationFiles.includes('gambit_predictions') && localeMigration.includes("'ja','fr','es'") && localeRows.includes("'ja','fr','es'") && provenanceMigration.includes('political_decision_source') && candidateColumns.includes('political_decision_source') && candidateColumns.includes('political_decision_confidence') && retryCounterColumns.length === 3 && immutability.rejectedAttackCount === immutability.attackCount && immutability.appendOnlyWritesSucceeded,
    latestMigration: migrationRows.at(-1)?.name ?? null,
    migrationCount: migrationRows.length,
    gambitTableCount: gambitTables.length,
    gambitIndexCount: indexes.length,
    foreignKeyViolations: foreignKeys.length,
    politicalProvenanceColumns: candidateColumns.filter(name => name === 'political_decision_source' || name === 'political_decision_confidence'),
    retryCounterColumns,
    translationLocales: ['en', 'zh', 'ja', 'fr', 'es'],
    immutability,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.overall) process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
