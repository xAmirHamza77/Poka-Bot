# Install Poka on a Windows server

1. Install Python 3.12+ **for all users**, with the Python launcher. Use Windows Server with Desktop Experience for computer control.
2. Extract this ZIP. Sign in as the Windows account whose desktop Poka will use.
3. Right-click **Setup.cmd → Run as administrator** under that same account.
4. Choose **Complete Windows server** or **Computer agent only**.
5. Complete the hostname/certificate fields and Windows account verification. Save the owner and agent tokens privately.
6. For full setup, connect the Poka desktop app to the HTTPS address shown by setup and sign in with the owner token. Configure your model in Settings → Models.
7. Open **Computer → Remote connection** to check the Windows connection. The full setup links the local agent automatically. For a separate backend, enter the agent HTTPS address and token here.

Full setup installs the backend, Windows agent, Caddy HTTPS, restart tasks, and daily server backups. Public DNS must point to the Windows server, with TCP 80/443 reachable. The wizard will not replace listeners already using those ports. Agent-only setup requires a trusted PEM TLS certificate and a backend IP allowlist.

The backend keeps running without a desktop login. GUI control requires the agent account signed in and unlocked. One agent controls one shared desktop. PowerShell runs with that account's permissions; the workspace is not a command sandbox. See windows-agent/README.md for session behavior and task controls, and deploy/README.md for individual installation options.

Automated contract and packaging checks run on macOS. Windows installer execution, scheduled tasks, certificate issuance, and native GUI control require verification on your Windows server.
