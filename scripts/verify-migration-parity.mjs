import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const migrationDirectory = join(repositoryRoot, 'migrations');
const wranglerEntry = join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const parityDatabaseName = 'codex-monitor-parity-db';
const parityDatabaseId = '00000000-0000-0000-0000-000000000020';
const parityTables = [
  'source_posts',
  'monitor_events',
  'reset_cycles',
  'reset_confirmation_evidence',
  'monitor_event_translations',
];
const parityReferenceTables = [
  'monitor_events',
  'reset_cycles',
  'reset_confirmation_evidence',
  'monitor_event_translations',
];

function runWrangler(worktree, persistTo, args) {
  try {
    return execFileSync(process.execPath, [wranglerEntry, ...args], {
      cwd: worktree,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    const stdout = error?.stdout ? String(error.stdout) : '';
    throw new Error(`Wrangler command failed: ${args.join(' ')}\n${stderr}\n${stdout}`);
  }
}

function executeSql(worktree, persistTo, sql) {
  const output = runWrangler(worktree, persistTo, [
    'd1', 'execute', parityDatabaseName,
    '--local',
    '--persist-to', persistTo,
    '--json',
    '--command', sql,
  ]);
  const parsed = JSON.parse(output);
  const result = parsed?.[0];
  if (!result?.success) throw new Error(`D1 query failed: ${sql}`);
  return result.results ?? [];
}

function executeSqlBatch(worktree, persistTo, statements) {
  const output = runWrangler(worktree, persistTo, [
    'd1', 'execute', parityDatabaseName,
    '--local',
    '--persist-to', persistTo,
    '--json',
    '--command', statements.map(statement => `${statement.trim().replace(/;$/, '')};`).join('\n'),
  ]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.some(result => !result?.success)) {
    throw new Error(`D1 batch query failed: ${statements.join('; ')}`);
  }
  return parsed.map(result => result.results ?? []);
}

function copyBaselineMigrations(worktree) {
  const localMigrations = join(worktree, 'migrations');
  for (let number = 1; number <= 19; number += 1) {
    const prefix = String(number).padStart(4, '0');
    const filename = requireMigrationFilename(prefix);
    cpSync(join(migrationDirectory, filename), join(localMigrations, filename));
  }
}

function requireMigrationFilename(prefix) {
  // This synchronous script runs in Node, so use the stable migration names
  // from the filesystem without relying on a shell glob.
  const candidates = [
    '0001_initial.sql',
    '0002_classification_retry.sql',
    '0003_data_integrity.sql',
    '0004_reset_cycles.sql',
    '0005_provider_usage_budget.sql',
    '0006_clear_raw_reset_time_text.sql',
    '0007_backfill_x_post_dates.sql',
    '0008_expire_stale_reset_cycles.sql',
    '0009_reconcile_lifecycle_and_provider_status.sql',
    '0010_fix_indexed_completion_confirmation.sql',
    '0011_manual_reset_reports.sql',
    '0012_correct_reset_completion_and_precedence.sql',
    '0013_community.sql',
    '0014_community_enhancements.sql',
    '0015_community_admin_posts.sql',
    '0016_community_translations.sql',
    '0017_monitor_event_translations.sql',
    '0018_community_agent_posts.sql',
    '0019_query_efficiency.sql',
  ];
  const filename = candidates.find(candidate => candidate.startsWith(`${prefix}_`));
  if (!filename) throw new Error(`Missing migration ${prefix}`);
  return filename;
}

function seedParityData(worktree, persistTo) {
  executeSql(worktree, persistTo, `
    INSERT INTO source_posts (id, source_account, source_post_id, source_url, text, published_at, fetched_at, raw_json, content_hash)
    VALUES
      (101, 'thsottiaux', 'parity-101', 'https://x.com/thsottiaux/status/parity-101', 'Codex reset planned', '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z', '{"n":1}', 'parity-hash-101'),
      (102, 'thsottiaux', 'parity-102', 'https://x.com/thsottiaux/status/parity-102', 'Codex reset completed', '2026-09-02T00:00:00.000Z', '2026-09-02T00:01:00.000Z', '{"n":2}', 'parity-hash-102');

    INSERT INTO monitor_events (
      id, source_post_id, category, title_en, title_zh, summary_en, summary_zh,
      confidence, published_at, effective_at, reset_at, source_url,
      evidence_quality, verification_status, verified_at, created_at, updated_at
    ) VALUES
      (201, 101, 'RESET_PLANNED', 'Reset planned', '计划重置', 'A reset is planned.', '重置已计划。', 0.71, '2026-09-01T00:00:00.000Z', NULL, NULL, 'https://x.com/thsottiaux/status/parity-101', 'DIRECT', 'DIRECT_VERIFIED', '2026-09-01T00:02:00.000Z', '2026-09-01T00:02:00.000Z', '2026-09-01T00:02:00.000Z'),
      (202, 102, 'RESET_COMPLETED', 'Reset completed', '重置完成', 'A reset completed.', '重置已完成。', 0.93, '2026-09-02T00:00:00.000Z', NULL, '2026-09-02T00:00:00.000Z', 'https://x.com/thsottiaux/status/parity-102', 'DIRECT', 'DIRECT_VERIFIED', '2026-09-02T00:02:00.000Z', '2026-09-02T00:02:00.000Z', '2026-09-02T00:02:00.000Z');

    INSERT INTO reset_cycles (
      id, status, planned_event_id, expected_reset_at, expected_reset_time_text,
      expected_timezone, is_approximate, time_confidence, due_at,
      confirmation_type, confirmation_confidence, confirmed_reset_at,
      confirmation_evidence_count, completed_event_id, verification_status,
      created_at, updated_at
    ) VALUES (
      301, 'CONFIRMED', 201, '2026-09-02T00:00:00.000Z', 'midnight UTC', 'UTC', 0, 'HIGH',
      '2026-09-02T00:00:00.000Z', 'DIRECT', 0.93, '2026-09-02T00:00:00.000Z', 1, 202,
      'DIRECT_VERIFIED', '2026-09-01T00:03:00.000Z', '2026-09-02T00:03:00.000Z');

    INSERT INTO reset_confirmation_evidence (
      id, reset_cycle_id, source_type, source_url, source_name, source_author,
      source_text, published_at, fetched_at, semantic_result, classification, created_at
    ) VALUES (
      401, 301, 'DIRECT', 'https://x.com/thsottiaux/status/parity-102', 'X', 'Tibo',
      'Codex reset completed', '2026-09-02T00:00:00.000Z', '2026-09-02T00:01:00.000Z',
      'confirmed', 'RESET_COMPLETED', '2026-09-02T00:01:00.000Z');

    INSERT INTO monitor_event_translations (
      id, event_id, language, title, summary, status, provider, translated_at,
      last_error, created_at, updated_at
    ) VALUES (
      501, 201, 'ja', 'リセット予定', 'リセットが予定されています。', 'translated', 'test',
      '2026-09-01T00:04:00.000Z', NULL, '2026-09-01T00:04:00.000Z', '2026-09-01T00:04:00.000Z');
  `);
}

function foreignKeyCheck(worktree, persistTo) {
  return executeSql(worktree, persistTo, 'PRAGMA foreign_key_check');
}

function stable(value) {
  return JSON.stringify(value);
}

function normalizeSql(sql) {
  return String(sql ?? '')
    .replace(/"/g, '')
    .replace(/_v2\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeMonitorEventsSql(sql) {
  return normalizeSql(sql)
    .replace(/check\(category in \([^)]*\)\)/, 'check(category in (category-values))');
}

function structuralSnapshot(worktree, persistTo) {
  const schema = {};
  const foreignKeySchema = {};
  const statements = [];
  for (const table of parityTables) statements.push(`PRAGMA table_info("${table}")`);
  for (const table of parityTables) statements.push(`PRAGMA foreign_key_list("${table}")`);
  statements.push(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name IN (${parityTables.map(table => `'${table}'`).join(',')})
    ORDER BY name;
  `);
  statements.push(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `);
  statements.push(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('trigger', 'view')
    ORDER BY type, name;
  `);
  const results = executeSqlBatch(worktree, persistTo, statements);
  for (let index = 0; index < parityTables.length; index += 1) {
    schema[parityTables[index]] = results[index];
    foreignKeySchema[parityTables[index]] = results[parityTables.length + index];
  }
  const tableDefinitions = Object.fromEntries(
    results[parityTables.length * 2].map(row => [row.name, [row]]),
  );
  return {
    schema,
    foreignKeySchema,
    tableDefinitions,
    indexes: results[parityTables.length * 2 + 1],
    triggersAndViews: results[parityTables.length * 2 + 2],
  };
}

function dataSnapshot(worktree, persistTo) {
  const results = executeSqlBatch(
    worktree,
    persistTo,
    parityTables.map(table => `SELECT * FROM "${table}" ORDER BY 1`),
  );
  const rows = Object.fromEntries(parityTables.map((table, index) => [table, results[index]]));
  return rows;
}

function compareStructuralParity(before, after) {
  const schema = {};
  const foreignKeys = {};
  const tableDefinitions = {};
  for (const table of parityTables) {
    schema[table] = stable(before.schema[table]) === stable(after.schema[table]);
    foreignKeys[table] = stable(before.foreignKeySchema[table]) === stable(after.foreignKeySchema[table]);
    const normalizeDefinition = (definition) => definition
      ? stable({
        name: normalizeSql(definition.name),
        sql: table === 'monitor_events' ? normalizeMonitorEventsSql(definition.sql) : normalizeSql(definition.sql),
      })
      : null;
    tableDefinitions[table] = normalizeDefinition(before.tableDefinitions[table]?.[0])
      === normalizeDefinition(after.tableDefinitions[table]?.[0]);
  }
  return {
    schema,
    foreignKeys,
    tableDefinitions,
    indexesMatch: stable(before.indexes) === stable(after.indexes),
    triggersAndViewsMatch: stable(before.triggersAndViews) === stable(after.triggersAndViews),
  };
}

function compareDataParity(before, after) {
  const rows = {};
  const counts = {};
  for (const table of parityTables) {
    counts[table] = { before: before[table].length, after: after[table].length };
    rows[table] = stable(before[table]) === stable(after[table]);
  }
  const references = {};
  for (const table of parityReferenceTables) {
    references[table] = rows[table];
  }
  return { counts, rows, references };
}

export function runMigrationParity() {
  if (!existsSync(wranglerEntry)) throw new Error(`Wrangler is not installed at ${wranglerEntry}`);
  const worktree = mkdtempSync(join(tmpdir(), 'tibo-p0-parity-'));
  const persistTo = join(worktree, 'd1-state');
  try {
    const localMigrations = join(worktree, 'migrations');
    mkdirSync(localMigrations, { recursive: true });
    writeFileSync(join(worktree, 'wrangler.jsonc'), JSON.stringify({
      name: 'codex-monitor-parity',
      compatibility_date: '2025-01-01',
      d1_databases: [{ binding: 'DB', database_name: parityDatabaseName, database_id: parityDatabaseId }],
    }, null, 2));
    copyBaselineMigrations(worktree);

    runWrangler(worktree, persistTo, [
      'd1', 'migrations', 'apply', parityDatabaseName,
      '--local', '--persist-to', persistTo,
    ]);
    seedParityData(worktree, persistTo);
    const beforeData = dataSnapshot(worktree, persistTo);
    const beforeStructure = structuralSnapshot(worktree, persistTo);

    cpSync(join(migrationDirectory, '0020_classifier_coverage.sql'), join(localMigrations, '0020_classifier_coverage.sql'));
    runWrangler(worktree, persistTo, [
      'd1', 'migrations', 'apply', parityDatabaseName,
      '--local', '--persist-to', persistTo,
    ]);

    const afterData = dataSnapshot(worktree, persistTo);
    const afterStructure = structuralSnapshot(worktree, persistTo);
    const dataParity = compareDataParity(beforeData, afterData);
    const structuralParity = compareStructuralParity(beforeStructure, afterStructure);
    const fkCheck = foreignKeyCheck(worktree, persistTo);

    const allCountsMatch = Object.values(dataParity.counts).every(({ before, after }) => before === after);
    const allRowsMatch = Object.values(dataParity.rows).every(Boolean);
    const allSchemaMatch = Object.values(structuralParity.schema).every(Boolean)
      && Object.values(structuralParity.foreignKeys).every(Boolean)
      && Object.values(structuralParity.tableDefinitions).every(Boolean);
    const overall = allCountsMatch
      && allRowsMatch
      && allSchemaMatch
      && structuralParity.indexesMatch
      && structuralParity.triggersAndViewsMatch
      && fkCheck.length === 0;

    return {
      overall,
      rows: dataParity.counts,
      dataMatch: dataParity.rows,
      referenceMatch: dataParity.references,
      schemaMatch: structuralParity.schema,
      foreignKeySchemaMatch: structuralParity.foreignKeys,
      tableDefinitionMatch: structuralParity.tableDefinitions,
      indexesMatch: structuralParity.indexesMatch,
      triggersAndViewsMatch: structuralParity.triggersAndViewsMatch,
      indexesBefore: beforeStructure.indexes,
      indexesAfter: afterStructure.indexes,
      triggersAndViewsBefore: beforeStructure.triggersAndViews,
      triggersAndViewsAfter: afterStructure.triggersAndViews,
      foreignKeyCheck: fkCheck,
    };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runMigrationParity();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.overall) process.exitCode = 1;
}
