import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputIndex = process.argv.indexOf('--out');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? resolve(process.argv[outputIndex + 1])
  : null;

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function latestMigration() {
  return readdirSync(join(root, 'migrations'))
    .filter(name => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .at(-1) || null;
}

function buildTimestamp() {
  const candidate = new Date(process.env.BUILD_TIMESTAMP || Date.now());
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : new Date().toISOString();
}

const provenance = {
  service: 'tibo-codex-monitor',
  environment: (process.env.BUILD_ENVIRONMENT || 'local').slice(0, 40),
  buildVersion: (process.env.BUILD_VERSION || packageVersion()).slice(0, 80),
  commitSha: (process.env.BUILD_SHA || gitSha()),
  generatedAt: buildTimestamp(),
  schemaVersion: (process.env.GAMBIT_CONFIG_VERSION || latestMigration() || 'unknown').slice(0, 80),
  gambitPromptVersion: 'gambit-prompts-v1',
  aiDisclosureVersion: 'v1',
};

const serialized = `${JSON.stringify(provenance, null, 2)}\n`;
if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized);
}
process.stdout.write(serialized);
