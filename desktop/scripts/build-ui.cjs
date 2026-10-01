const { spawnSync } = require('node:child_process');
const { cpSync, rmSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: path.join(root, 'client'), stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, NEXT_PUBLIC_POKA_VERSION: require('../package.json').version, DESKTOP_BUILD: '1', NEXT_PUBLIC_API_URL: '/api/v1' },
});
if (result.status !== 0) process.exit(result.status || 1);
const dest = path.join(root, 'desktop/resources/ui');
rmSync(dest, { recursive: true, force: true });
cpSync(path.join(root, 'client/out'), dest, { recursive: true });
