const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { createLocalServer } = require('./local-server.cjs');
let window, backend, server, origin, ownerToken, backendPort, shuttingDown = false, remote = false;
function validateServer(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Enter an HTTPS server address, with an optional port and no path.');
  return url.origin;
}
function savedServer() {
  if (process.env.POKA_SERVER_URL) return validateServer(process.env.POKA_SERVER_URL);
  const file = path.join(app.getPath('userData'), 'server.json');
  return fs.existsSync(file) ? validateServer(JSON.parse(fs.readFileSync(file, 'utf8')).url) : null;
}

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function waitForBackend() {
  for (let i = 0; i < 150; i++) {
    if (backend.exitCode !== null) throw new Error('The local backend stopped during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Retry while the bundled backend starts. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('The local backend did not start in time.');
}
async function signIn() {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ownerToken }),
  });
  if (!response.ok) throw new Error('Could not establish the desktop session.');
  const cookie = response.headers.get('set-cookie')?.match(/poka_session=([^;]+)/)?.[1];
  if (!cookie) throw new Error('The backend did not return a session.');
  await session.defaultSession.cookies.set({ url: origin, name: 'poka_session', value: cookie,
    httpOnly: true, sameSite: 'lax', path: '/', expirationDate: Date.now() / 1000 + 86400 });
}
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 860, minHeight: 600,
    title: 'Poka', backgroundColor: '#191919', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: { additionalArguments: [`--poka-version=${app.getVersion()}`, `--poka-remote=${remote}`, `--poka-server=${remote ? origin : ''}`], preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  window.on('closed', () => { window = null; });
  window.loadURL(`${origin}/app/`);
}
app.setName('Poka');
nativeTheme.themeSource = 'dark';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    try {
      const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');
      const remoteOrigin = savedServer();
      if (remoteOrigin) { remote = true; origin = remoteOrigin; }
      else {
      backendPort = await freePort();
      server = createLocalServer(path.join(resources, 'ui'), backendPort);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43821, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      ownerToken = randomBytes(32).toString('hex');
      const dataDir = path.join(app.getPath('userData'), 'data');
      const workspace = path.join(app.getPath('documents'), 'Poka');
      fs.mkdirSync(workspace, { recursive: true });
      const executable = path.join(resources, 'backend/poka-api', process.platform === 'win32' ? 'poka-api.exe' : 'poka-api');
      const embeddedPython = path.join(resources, 'backend/python/python.exe');
      const useEmbedded = process.platform === 'win32' && !fs.existsSync(executable) && fs.existsSync(embeddedPython);
      const command = useEmbedded ? embeddedPython : executable;
      const args = useEmbedded ? ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'] : [];
      if (!fs.existsSync(command)) throw new Error('The bundled local backend is missing.');
      backend = spawn(command, args, { windowsHide: true, cwd: workspace,
        env: { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', DATA_DIR: dataDir,
          WORKSPACE_ROOT: workspace, CORS_ORIGINS: origin, APP_AUTH_TOKEN: ownerToken, AUTH_COOKIE_SECURE: '0' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let launchError;
      backend.on('error', error => { launchError = error; });
      // Avoid displaying logs that could contain private provider data.
      backend.stderr.resume();
      await waitForBackend();
      if (launchError) throw launchError;
      await signIn();
      }
      const trusted = event => event.sender === window?.webContents && event.senderFrame?.url.startsWith(origin + '/');
      for (const action of ['minimize', 'maximize', 'close']) ipcMain.handle(`window:${action}`, event => {
        if (!trusted(event)) return;
        if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
        else window[action]();
      });
      ipcMain.handle('session:sign-in', async event => { if (!trusted(event)) throw new Error('Untrusted window'); if (remote) throw new Error('Sign in with your server owner token.'); await signIn(); });
      ipcMain.handle('server:connect', (event, url) => {
        if (!trusted(event)) throw new Error('Untrusted window');
        const file = path.join(app.getPath('userData'), 'server.json');
        if (url) fs.writeFileSync(file, JSON.stringify({ url: validateServer(url) }), { mode: 0o600 });
        else if (fs.existsSync(file)) fs.unlinkSync(file);
        app.relaunch(); app.quit();
      });
      session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(permission === 'media' && details.mediaTypes?.every(type => type === 'audio') && _contents === window?.webContents && new URL(_contents.getURL()).origin === origin));
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ label: 'Poka', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
        { label: 'Workspace', submenu: [{ label: 'Connect to hosted server…', click: async () => {
          const result = await dialog.showOpenDialog({ title: 'Choose a Poka server configuration (JSON with url)', filters: [{ name: 'Poka server', extensions: ['json'] }], properties: ['openFile'] });
          if (result.canceled) return;
          try { const url = validateServer(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')).url); fs.writeFileSync(path.join(app.getPath('userData'), 'server.json'), JSON.stringify({ url }), { mode: 0o600 }); app.relaunch(); app.quit(); }
          catch (error) { dialog.showErrorBox('Invalid server configuration', error.message); }
        } }, { label: 'Use local workspace', click: () => { const file = path.join(app.getPath('userData'), 'server.json'); if (fs.existsSync(file)) fs.unlinkSync(file); app.relaunch(); app.quit(); } }] },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
      ]));
      createWindow();
      backend?.on('exit', () => { if (!shuttingDown) { dialog.showErrorBox('Poka backend stopped', 'Restart Poka to reconnect to your local workspace.'); app.quit(); } });
      app.on('activate', () => { if (!window) createWindow(); });
    } catch (error) { dialog.showErrorBox('Poka could not start', `${error.message}\nRebuild or reinstall the desktop app and try again.`); app.quit(); }
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { shuttingDown = true; backend?.kill(); server?.close(); ownerToken = null; });
