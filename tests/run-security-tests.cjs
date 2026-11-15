const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = readdirSync(__dirname).filter(file => file.endsWith('.test.cjs')).sort().map(file => path.join(__dirname, file));
if (!files.length) throw new Error('No security regression tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
