import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('closes the bundled update-check request when a registry stops responding', () => {
  const require = createRequire(import.meta.url);
  const bundle = readFileSync(join(dirname(require.resolve('wrangler/package.json')), 'wrangler-dist/cli.js'), 'utf8');
  const handler = bundle.match(/\}\)\.on\("error", reject\)\.on\("timeout", (function \(\) \{ this\.destroy\(new Error\("npm update check timed out"\)\); \})\);/)?.[1];
  expect(handler).toBeTruthy();
  // Exercise the actual bundled timeout handler against a server that accepts
  // a request but never replies. A leaked socket prevents natural child exit.
  const result = spawnSync(process.execPath, ['-e', `
    const http = require('node:http');
    const assert = require('node:assert/strict');
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      http.get({host:'127.0.0.1',port:server.address().port,timeout:50})
        .on('timeout', ${handler})
        .on('error', error => {
          assert.equal(error.message, 'npm update check timed out');
          server.close(() => console.log('request closed'));
        });
    });
  `], { encoding: 'utf8', timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('request closed');
});
