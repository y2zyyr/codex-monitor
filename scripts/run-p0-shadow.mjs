import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputPath = process.env.P0_SHADOW_OUTPUT || join('/tmp', 'tibo-p0-shadow.json');
const vitestEntry = join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');

function writeBlockedReport(reason) {
  const report = {
    status: 'BLOCKED_NO_CREDENTIAL',
    reason,
    provider: {
      base_url: process.env.LLM_BASE_URL || 'https://opencode.ai/zen/go/v1',
      model: process.env.LLM_MODEL || 'mimo-v2.5',
    },
    samples: [],
    note: 'No provider request was made. Set LLM_API_KEY in a secure local environment and rerun this command.',
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  if (!process.env.LLM_API_KEY?.trim()) {
    writeBlockedReport('LLM_API_KEY is not available in the local environment.');
    return 2;
  }
  if (!existsSync(vitestEntry)) {
    writeBlockedReport(`Vitest entry is missing: ${vitestEntry}`);
    return 2;
  }

  const result = spawnSync(process.execPath, [vitestEntry, 'run', 'tests/p0-shadow.test.ts', '--reporter=dot'], {
    cwd: repositoryRoot,
    env: { ...process.env, P0_LLM_SHADOW: '1', P0_SHADOW_OUTPUT: outputPath },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

process.exitCode = main();
