# Poka Windows computer agent

Runs on Windows Server with **Desktop Experience**, or Windows 10/11, as a signed-in desktop account. Server Core cannot provide desktop screenshots or GUI input. The agent supports browser navigation, native desktop screenshots, keyboard/mouse input, PowerShell commands, and workspace files. One agent controls one shared desktop; assistants have separate file and browser-profile folders, but their visible windows share that desktop. Use separate Windows machines/agents for isolated desktops.

## Install and credentials

1. Install Python 3.12+ with its `py` launcher on the Windows server.
2. Sign in as the Windows account whose desktop Poka should use. Unzip the agent bundle.
3. Run `./install.ps1` in PowerShell. Setup prompts for **that Windows account's credentials**, verifies them locally, and does not store the Windows password or send it to Poka. It creates an interactive scheduled task at logon, with automatic restart on failure.
4. Save the generated agent access token in a password manager. In **Poka → Settings → Computer**, choose Windows server, enter the agent address and token, save, and check the connection. The token is encrypted in Poka's workspace database. The Windows copy is protected with the account's DPAPI and restricted directory permissions.

For a Poka backend running on the same Windows machine, the default address is `http://127.0.0.1:8765`. This localhost address means the **backend machine**, not the Mac/Windows app viewing a hosted backend.

For a Poka backend on another machine, provide a trusted HTTPS certificate (PEM chain and private key) matching the Windows agent hostname, and allow only the Poka backend's IP. Run PowerShell as administrator **under the same desktop account**:

```powershell
./install.ps1 -Listen 0.0.0.0 -Port 8765 -Certificate C:\certs\fullchain.pem -PrivateKey C:\certs\privkey.pem -AllowedBackendAddress 209.46.123.170
```

Then enter `https://windows-agent.example.com:8765` in Poka. Keep the certificate renewed and rerun setup when replacing its files; rerunning setup generates a new access token. A trusted TLS reverse proxy or private tunnel can also forward to the default localhost agent. The installer does not create a domain, obtain a certificate, enable RDP, or change Windows login/lock policies.

## Desktop availability

The interactive scheduled task runs only while its account is logged on. GUI actions need that desktop unlocked and available; UAC secure desktops and elevated applications may block input. Locked/disconnected RDP sessions can make screenshots/input unavailable. Poka reports that condition and asks you to restore the session. PowerShell and workspace listing can continue while the agent process is running, even when GUI control is unavailable. No automatic Windows login is enabled and no GUI success is simulated.

Use a dedicated desktop account. PyAutoGUI's corner fail-safe stays enabled. Start/Pause/Stop control Poka's automation session, not Windows power or the agent task. Stop and Reset close the assistant's managed browser; files and browser profile are retained. Cleanup removes the automation record and retains workspace files.

Workspace file paths accept `/workspace`, `/workspace/subfolder`, or an absolute Windows path **inside that assistant's workspace**. PowerShell starts in the assistant workspace and runs with the signed-in account's rights. It is not a security sandbox. Computer writes continue through Poka's approval and audit system.

Task controls:

```powershell
Get-ScheduledTask -TaskName 'Poka Windows Agent'
Stop-ScheduledTask -TaskName 'Poka Windows Agent'
Start-ScheduledTask -TaskName 'Poka Windows Agent'
```

To uninstall, stop/unregister that task, remove its firewall rule if present, then remove `%LOCALAPPDATA%\Poka\WindowsAgent` after saving any workspace files.

## Standalone Poka backend on Windows

The desktop app already includes a local backend. For a separate always-running backend on Windows, see `deploy/install-windows.ps1` in the server bundle. The backend can run without an interactive desktop, while the computer agent must run in the user's interactive session. Configure a provider model and connect the Windows agent from Poka Settings. Secure remote backend access with a trusted HTTPS proxy before connecting the desktop app.
