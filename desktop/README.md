# Poka desktop

Poka is the desktop version of this local AI workspace. It includes the web interface and a bundled Python API, starts the backend automatically, and establishes an HttpOnly local session without exposing the owner credential to the renderer.

## Run the built apps

- macOS Apple Silicon: open `dist/Poka-0.3.6-arm64.dmg` and drag Poka into Applications.
- Windows x64 installer: run `dist/Poka Setup 0.3.6.exe`.
- Windows x64 portable: extract `dist/Poka-0.3.6-win.zip` and run `Poka.exe`. Keep the extracted resources alongside the executable.

These local builds are unsigned. The macOS app is not notarized, and the Windows package has not been run on a Windows machine. A Windows NSIS installer and portable ZIP are included. The workflow can rebuild them on a native Windows runner. Signing and notarization require the publisher's certificates; none are supplied by this project.

On first launch, Settings opens to Custom model setup. Choose Chat Completions, Responses, or Prediction; enter an API root, exact model IDs, and a default model. Remote providers generally require a key. Local endpoints can omit it. Save the configuration, then use Check saved connection to read the provider's `/models` catalog. This checks catalog access and model presence, not successful inference. Providers without `/models` may still work for chat.

Ollama and LM Studio templates only fill the local URL and Chat Completions protocol. Install/start the model server separately and use the exact installed model ID. The first configured model is applied to the currently selected assistant; subsequent configuration changes preserve existing assistants' models.

Chats, provider configuration, and credentials are stored by the local API under the operating system's Poka application data directory. Keys and custom header values are encrypted at rest. Goals, artifacts, and profile values are stored in the desktop Chromium profile on this device. The frontend uses a fixed loopback port (43821) so these values persist across restarts. If another process occupies that port, Poka displays a startup error instead of attaching to that process. The API uses a separate ephemeral loopback port. Workspace actions are confined to the `Poka` folder in Documents.

Goals are a manual checklist. Artifacts support documents and saved web/media links. They do not imply autonomous scheduling or image/video generation. The optional computer runtime retains the project's existing fake/Docker/remote provider configuration.

Shortcuts: Cmd/Ctrl+, opens Settings; Cmd/Ctrl+K opens Search; Cmd/Ctrl+N creates an assistant. Shift+Enter inserts a new line in chat. Voice input depends on speech recognition support in the runtime.

## Build on the target operating system

Requirements: Node.js 22.12+, Python 3.12+, and npm. Install frontend and desktop dependencies, then the backend build tools:

```sh
npm install --prefix client
npm install --prefix desktop
python -m pip install -r server/requirements.txt pyinstaller
npm test --prefix desktop
```

On macOS, run `npm run dist:mac --prefix desktop`. On Windows, run `npm run dist:win --prefix desktop`. PyInstaller bundles the interpreter and backend dependencies for the current host architecture. Set `POKA_BUILD_PYTHON` to an absolute Python executable if using a virtual environment. Build on each target architecture to include the matching Python runtime; changing only Electron's architecture is insufficient.

For development, run `npm run prepare:app --prefix desktop`, then `npm start --prefix desktop`. The GitHub Actions workflow builds both platforms and uploads packages without publishing releases.

The local cross-built Windows ZIP uses the official CPython 3.12.10 embedded runtime and Windows dependency wheels. `build/windows-local.json` selects that backend. Native Windows builds use PyInstaller instead. `scripts/windows-icon.cjs` embeds the supplied Poka icon and product metadata into the unsigned Windows executable for the cross-build.

The renderer uses sandboxing, context isolation, and no Node integration. Navigation outside the local app is opened in the system browser. The loopback UI server rejects mismatched hosts and origins and proxies streaming API requests without buffering. Native IPC accepts only window controls and local session reconnection from the app's own frame.

Validation: 86 backend unit tests, loopback UI/proxy tests, packaged backend smoke checks (authentication, custom catalog, streaming, persistence, and expired sessions), Windows package-content and icon metadata checks, and a native macOS launch. Windows execution still needs validation on Windows.

## Hosted background work (Poka 0.3.0)

Settings → Server connects to a separate HTTPS backend. Jobs are stored before execution and continue when the app closes. Reopening a chat restores progress. Use Activity to inspect status and Stop to cancel. Local mode runs jobs only while the bundled backend is open; use the hosted setup in [deploy/README.md](../deploy/README.md) for continuous availability. The native Workspace menu can restore local mode if the server is unreachable.
