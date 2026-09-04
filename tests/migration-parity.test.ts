import { describe, expect, it } from 'vitest';
import { runMigrationParity } from '../scripts/verify-migration-parity.mjs';

describe('0020 migration parity', () => {
  it('preserves rows, references, schema, indexes, triggers/views, and FK integrity', {
    timeout: 180_000,
  }, () => {
    const report = runMigrationParity();

    expect(report.overall).toBe(true);
    for (const counts of Object.values(report.rows)) {
      expect(counts.before).toBe(counts.after);
    }
    for (const match of Object.values(report.dataMatch)) expect(match).toBe(true);
    for (const match of Object.values(report.referenceMatch)) expect(match).toBe(true);
    for (const match of Object.values(report.schemaMatch)) expect(match).toBe(true);
    for (const match of Object.values(report.foreignKeySchemaMatch)) expect(match).toBe(true);
    for (const match of Object.values(report.tableDefinitionMatch)) expect(match).toBe(true);
    expect(report.indexesMatch).toBe(true);
    expect(report.triggersAndViewsMatch).toBe(true);
    expect(report.foreignKeyCheck).toEqual([]);
  });
});
