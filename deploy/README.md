# Poka server

This deployment is separate from the Mac/Windows app. One API process runs a SQLite-backed worker queue. Submitting a message creates a durable job before returning. SSE only reads its saved event log; disconnecting or closing the desktop app cannot cancel execution. Open the chat again to restore progress, or press Stop to cancel explicitly.

Queued jobs survive a restart. Interrupted plain model inference retries up to three attempts. Slash-command tool jobs are marked interrupted instead of replayed, because repeating a write could have side effects. Completed replies are detected on recovery to prevent duplicate inference. Approval requests still require the owner and expire according to the existing action policy. The default job time limit is 30 minutes. This is continuous service availability, not an unlimited autonomous task loop.

## Ubuntu deployment

Upload `server/`, this `deploy/` folder and the static `client/out/` as `/opt/poka/ui/`. Install Python 3.12 with venv and an official Caddy binary in `/opt/poka/bin/caddy`. Create a `poka` system user and `/var/lib/poka/{data,workspace,backups,caddy}` owned by it. Create `/opt/poka/venv`, install `server/requirements.txt` and keep application code root-owned. Copy the example environment to `/etc/poka/server.env`, mode 0600, replacing the host. Create `/etc/poka/web.env` with `POKA_HOST=your-domain-or-IP` and `POKA_HTTPS_PORT=8443`.

You can automate the initial installation with `bash /opt/poka/deploy/install-ubuntu.sh YOUR_HOST 8443` after uploading the folders.

Install the service and timer files in `/etc/systemd/system/`, run `systemctl daemon-reload`, and enable/start `poka.service`, `poka-web.service`, and `poka-backup.timer`. Allow incoming TCP 80 (certificate validation) and 8443. API port 18400 remains loopback-only. Port 443 is unused by this configuration so it can coexist with an existing service. Caddy maintains a publicly trusted short-lived ACME certificate, including for a public IP. Keep port 80 reachable for renewal.

The owner sign-in token is created at `/var/lib/poka/data/.auth-token`, readable only by the service user/root. Retrieve it privately over SSH. Model credentials are configured through the app and encrypted in the persistent data directory. Do not publish the token or encryption key. No credentials are included in this repository.

## Desktop connection

In Poka Settings → Server, enter `https://your-host:8443` and select Connect and restart. Sign in using the owner token, then configure the hosted model. Local provider settings and history remain in the local workspace; they are not automatically transferred. To choose a server before first launch, set `POKA_SERVER_URL`. A saved server can be removed through Settings or the native Workspace menu if the endpoint is unavailable.

## Operations and recovery

Check `systemctl status poka poka-web` and `journalctl -u poka --since today`. Never run multiple API workers against the same queue. Both units start on boot and restart on failure. The daily timer uses SQLite's online backup API and saves private archives in `/var/lib/poka/backups`, retaining 14 archives. These are on-server backups; copy them off-server to protect against disk loss.

Before upgrades, run `systemctl start poka-backup`. Update application code and UI, install requirements, then restart `poka` and `poka-web`. To restore, stop `poka`, preserve the existing data folder, extract a chosen archive into `/var/lib/poka`, ensure ownership is `poka:poka`, and restart. Database and encryption key must come from the same backup. Backups include workspace files and saved model settings.

The computer provider defaults to the existing demonstration provider; a production computer runtime must be configured separately. Goals/artifact bookmarks remain client-local in the current UI and are not autonomous server tasks.

## Guided Windows server installation

Extract the complete Poka server ZIP on a Windows server with Desktop Experience and an all-users Python 3.12+ installation. Sign in as the desktop account, open PowerShell as administrator under that account, and run:

```powershell
./deploy/setup-windows.ps1
```

The wizard offers a full Windows setup or a computer-agent-only setup for an existing Poka backend. Full setup installs a persistent backend task, prompts for Windows account verification, installs the interactive desktop agent, stores its token encrypted in the backend database, and configures Caddy HTTPS with checksum verification and restart tasks. It prompts for a public hostname; point DNS to the server and allow TCP 80/443. It refuses to replace existing listeners on those ports. Python must be installed for all users so the backend's SYSTEM task can access its runtime. Rerunning an existing full setup with active HTTPS requires using the individual installers and existing proxy configuration.

The backend runs independently of Windows logon; GUI automation requires the desktop account to remain signed in and unlocked. Full setup leaves the agent on localhost; no agent token or unencrypted agent port is exposed to the internet. For agent-only setup, provide a trusted TLS certificate and the backend IP allowlist. Windows passwords are verified locally and not persisted; agent tokens use DPAPI on Windows and encryption in Poka storage. Tasks: `Poka Server`, `Poka HTTPS`, `Poka Windows Agent`. Installer output includes the owner/agent tokens once; save them privately.

In Poka, open **Computer → Remote connection** to save the Windows agent address/token and check desktop readiness. Computer Tools includes browser navigation, PowerShell, files, text input and keyboard shortcuts. Clicking the live desktop requests a pointer action. Write actions use the existing approval and audit flow. One agent is one shared Windows desktop; separate assistants do not get isolated desktops.

Automated contract tests run on the build machine with a simulated Windows driver. A real Windows server is still required to validate scheduled tasks, certificates, RDP/session behavior and native UI control.
