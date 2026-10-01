# Separate backend, installed as a persistent SYSTEM scheduled task. Requires administrator.
[CmdletBinding()]
param([string]$InstallPath = (Join-Path $env:ProgramData 'PokaServer'), [string]$PublicOrigin = '', [string]$PythonExe = '')
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) { throw 'Run PowerShell as administrator.' }
if ($PublicOrigin -and $PublicOrigin -notmatch '^https://[^/]+$') { throw 'PublicOrigin must be an HTTPS origin without a path.' }
$bundle = Split-Path $PSScriptRoot -Parent
if (!(Test-Path (Join-Path $bundle 'server\app')) -or !(Test-Path (Join-Path $bundle 'ui'))) { throw 'Extract the complete Poka server bundle first.' }
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
& icacls.exe $InstallPath /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the server directory.' }
Stop-ScheduledTask -TaskName 'Poka Server' -ErrorAction SilentlyContinue
Copy-Item (Join-Path $bundle 'server') $InstallPath -Recurse -Force
Copy-Item (Join-Path $bundle 'ui') $InstallPath -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot 'run-windows-server.ps1') $InstallPath -Force
Copy-Item (Join-Path $PSScriptRoot 'backup-windows.py') $InstallPath -Force
if (!$PythonExe) { $PythonExe = & py -3 -c 'import sys; print(sys.executable)' }
if (!(Test-Path $PythonExe)) { throw 'Provide -PythonExe with an all-users Python 3.12+ installation.' }
& $PythonExe -m venv (Join-Path $InstallPath '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Python environment setup failed.' }
& (Join-Path $InstallPath '.venv\Scripts\python.exe') -m pip install -r (Join-Path $InstallPath 'server\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Server dependency installation failed.' }
$configPath = Join-Path $InstallPath 'config.json'
if (Test-Path $configPath) { $config = Get-Content $configPath -Raw | ConvertFrom-Json }
else {
    $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
    $config = [pscustomobject]@{APP_AUTH_TOKEN=[Convert]::ToBase64String($bytes);DATA_DIR=(Join-Path $InstallPath 'data');WORKSPACE_ROOT=(Join-Path $InstallPath 'workspace');AUTH_COOKIE_SECURE='1';COMPUTER_PROVIDER='fake';CORS_ORIGINS=$PublicOrigin}
}
if ($PublicOrigin) { $config.CORS_ORIGINS = $PublicOrigin }
$config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallPath 'run-windows-server.ps1')`"" -WorkingDirectory $InstallPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Poka Server' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'Poka Server'
$backupAction = New-ScheduledTaskAction -Execute (Join-Path $InstallPath '.venv\Scripts\python.exe') -Argument "`"$(Join-Path $InstallPath 'backup-windows.py')`"" -WorkingDirectory $InstallPath
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '03:15'
Register-ScheduledTask -TaskName 'Poka Backup' -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host 'Poka backend installed on localhost:18400. Set up a trusted HTTPS proxy serving the ui folder and forwarding /api/* to this backend.'
Write-Host "Owner token: $($config.APP_AUTH_TOKEN)"
Write-Host 'Install the Windows Agent separately in the signed-in desktop account, then connect it in Poka Settings > Computer.'
