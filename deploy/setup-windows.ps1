# Guided server-side setup. Run under the Windows desktop account, as administrator.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) { throw 'Open PowerShell as administrator under the account whose Windows desktop Poka will use.' }
$bundle = Split-Path $PSScriptRoot -Parent
Write-Host 'Poka Server Setup'
Write-Host '1. Complete Windows server: backend, HTTPS, and computer agent'
Write-Host '2. Computer agent only: connect to a Poka backend on another server'
$mode = Read-Host 'Choose 1 or 2'
if ($mode -notin @('1','2')) { throw 'Choose 1 or 2.' }
$agentPath = Join-Path $env:LOCALAPPDATA 'Poka\WindowsAgent'
$serverPath = Join-Path $env:ProgramData 'PokaServer'
if ($mode -eq '2') {
    Write-Host 'Use a trusted TLS PEM certificate for the Windows agent hostname.'
    $certificate = Read-Host 'Full-chain certificate path'
    $privateKey = Read-Host 'Private key path'
    $allowed = (Read-Host 'Poka backend IP addresses, separated by commas').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    & (Join-Path $bundle 'windows-agent\install.ps1') -Listen 0.0.0.0 -Certificate $certificate -PrivateKey $privateKey -AllowedBackendAddress $allowed -InstallPath $agentPath
    Write-Host 'Open Poka > Computer > Remote connection. Enter https://your-agent-hostname:8765 and the displayed agent token.'
    return
}
$domain = (Read-Host 'Public DNS hostname for Poka, e.g. poka.example.com').Trim().ToLowerInvariant()
if ($domain -notmatch '^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' -or $domain -notmatch '\.' -or $domain -match '\.\.') { throw 'Enter a DNS hostname without a URL, port, or path.' }
Write-Host "DNS for $domain must point to this server. Ports 80 and 443 must be reachable."
$busyPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(80,443) }
if ($busyPorts) { throw 'Ports 80/443 are in use. Configure your existing HTTPS proxy with Caddyfile.windows.example and run the individual installers instead.' }
$python = ''
try { $python = & py -3 -c 'import sys; print(sys.executable)' } catch {}
if (!$python -or !(Test-Path $python)) { $python = Read-Host 'Path to an all-users Python 3.12+ python.exe installation' }
if (!(Test-Path $python)) { throw 'Install Python 3.12+ for all users and rerun setup.' }
& (Join-Path $PSScriptRoot 'install-windows.ps1') -InstallPath $serverPath -PublicOrigin "https://$domain" -PythonExe $python
& (Join-Path $bundle 'windows-agent\install.ps1') -InstallPath $agentPath -PythonExe $python
# Link the co-located backend and agent without sending tokens through command arguments.
Stop-ScheduledTask -TaskName 'Poka Server'
$config = Get-Content (Join-Path $serverPath 'config.json') -Raw | ConvertFrom-Json
$env:DATA_DIR = $config.DATA_DIR
$env:APP_AUTH_TOKEN = $config.APP_AUTH_TOKEN
$secureToken = Import-Clixml (Join-Path $agentPath 'token.xml')
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try { $env:POKA_SETUP_AGENT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
Push-Location (Join-Path $serverPath 'server')
try {
    $env:PYTHONPATH = Join-Path $serverPath 'server'
    & (Join-Path $serverPath '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'link-windows-agent.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not save the computer connection.' }
} finally {
    Pop-Location
    Remove-Item Env:POKA_SETUP_AGENT_TOKEN,Env:DATA_DIR,Env:APP_AUTH_TOKEN,Env:PYTHONPATH -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName 'Poka Server'
}
# Download the official Caddy binary and verify the release checksum.
$version = '2.11.4'
$base = "https://github.com/caddyserver/caddy/releases/download/v$version"
$archiveName = "caddy_${version}_windows_amd64.zip"
$download = Join-Path $serverPath $archiveName
Invoke-WebRequest "$base/$archiveName" -OutFile $download -UseBasicParsing
$checksums = (Invoke-WebRequest "$base/caddy_${version}_checksums.txt" -UseBasicParsing).Content
$line = ($checksums -split "`n" | Where-Object { $_ -match ([regex]::Escape($archiveName) + '$') })
$expected = ($line -split '\s+')[0]
if ($expected.Length -ne 128 -or (Get-FileHash $download -Algorithm SHA512).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'Caddy release checksum did not match.' }
Expand-Archive $download (Join-Path $serverPath 'caddy') -Force
Remove-Item $download
$uiRoot = (Join-Path $serverPath 'ui').Replace('\','/')
$caddyConfig = @"
{
    admin 127.0.0.1:20191
}
$domain {
    handle /api/* {
        reverse_proxy 127.0.0.1:18400
    }
    handle {
        root * "$uiRoot"
        try_files {path} {path}/index.html
        file_server
    }
}
"@
[IO.File]::WriteAllText((Join-Path $serverPath 'Caddyfile'), $caddyConfig, [Text.UTF8Encoding]::new($false))
$caddy = Join-Path $serverPath 'caddy\caddy.exe'
& $caddy validate --config (Join-Path $serverPath 'Caddyfile') --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'HTTPS configuration validation failed.' }
$action = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$(Join-Path $serverPath 'Caddyfile')`" --adapter caddyfile" -WorkingDirectory $serverPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Poka HTTPS' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Get-NetFirewallRule -DisplayName 'Poka HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Poka HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -Profile Any | Out-Null
Start-ScheduledTask -TaskName 'Poka HTTPS'
$ready = $false
for ($attempt = 0; $attempt -lt 18; $attempt++) {
    try { $result = Invoke-RestMethod "https://$domain/api/v1/health" -TimeoutSec 5; if ($result.status -eq 'ok' -or $result.status -eq 'healthy' -or $result.status -eq 'online') { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 5
}
if (!$ready) { Write-Warning 'Setup tasks are installed, but HTTPS is not verified yet. Check DNS, certificate issuance, and firewall before connecting.' }
else { Write-Host "Poka is ready: https://$domain/app/" }
Write-Host "Desktop connection: https://$domain"
Write-Host 'Sign in using the owner token shown above. Open Computer > Remote connection to check the Windows session.'
