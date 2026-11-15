const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const esbuild = require('esbuild');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipesafe-session-tests-'));
const output = path.join(directory, 'session.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'session-stores.test.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.resolve(__dirname, '../package.json'))});` },
});
require(output);
test.after(() => {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  fs.rmSync(directory, {recursive: true, force: true});
});
