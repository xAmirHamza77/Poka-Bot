const { spawnSync } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dest = path.join(root, 'desktop/resources/backend');
mkdirSync(dest, { recursive: true });
rmSync(path.join(dest, 'open-dots-api'), { recursive: true, force: true });
rmSync(path.join(dest, 'poka-api'), { recursive: true, force: true });
const python = process.env.POKA_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
  '--name', 'poka-api', '--distpath', dest,
  '--workpath', path.join(root, 'desktop/build/pyinstaller'),
  '--specpath', path.join(root, 'desktop/build'), '--paths', path.join(root, 'server'),
  '--collect-all', 'app', '--collect-all', 'uvicorn', '--collect-all', 'sse_starlette',
  path.join(root, 'server/desktop_entry.py')], { cwd: path.join(root, 'server'), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
