// Wrangler 4.125.0 bundles update-check 1.5.4 three times. Its timeout
// handler rejects without closing the HTTP request, retaining a TLS socket.
// Keep this local-tooling patch version- and content-guarded until upstream
// supplies request cancellation. It never changes a command's exit status.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('wrangler/package.json');
const { version } = JSON.parse(readFileSync(packagePath, 'utf8'));
if (version !== '4.125.0') throw new Error('Reassess the Wrangler update-check patch before changing Wrangler versions.');
const path = join(dirname(packagePath), 'wrangler-dist/cli.js');
const original = '}).on("error", reject).on("timeout", reject);';
const fixed = '}).on("error", reject).on("timeout", function () { this.destroy(new Error("npm update check timed out")); });';
const source = readFileSync(path, 'utf8');
const count = text => source.split(text).length - 1;
if (count(fixed) === 3 && count(original) === 0) {
  console.log('Wrangler update-check request cleanup already applied.');
} else {
  if (count(original) !== 3 || count(fixed) !== 0) throw new Error('Unexpected Wrangler bundle; refusing to patch.');
  writeFileSync(path, source.replaceAll(original, fixed));
  console.log('Applied Wrangler update-check request cleanup (3 bundled copies).');
}
