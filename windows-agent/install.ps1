# Run from PowerShell while signed in as the account whose desktop Poka will use.
[CmdletBinding()]
param(
    [string]$PythonExe = '',
    [string]$Listen = '127.0.0.1',
    [int]$Port = 8765,
    [string]$Certificate = '',
    [string]$PrivateKey = '',
    [string[]]$AllowedBackendAddress = @(),
    [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'Poka\WindowsAgent')
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this installer on Windows with Desktop Experience.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
if ($Listen -notin @('127.0.0.1', '0.0.0.0')) { throw 'Listen must be 127.0.0.1 or 0.0.0.0.' }
if ($Listen -eq '0.0.0.0' -and (!$Certificate -or !$PrivateKey -or !$AllowedBackendAddress.Count)) { throw 'Remote access requires a trusted TLS certificate, private key, and allowed backend IP addresses.' }
if ($Listen -eq '0.0.0.0') {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (!$isAdmin) { throw 'Remote setup requires PowerShell as administrator, using the desktop account.' }
}
$current = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$credential = Get-Credential -UserName $current -Message 'Verify the Windows account whose signed-in desktop Poka will control. Password is checked locally and is not saved.'
if (!$credential) { throw 'Windows account verification was cancelled.' }
$account = New-Object Security.Principal.NTAccount($credential.UserName)
if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Sign in as this Windows account before running setup.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PokaWindowsLogon {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr token);
}
'@
$user = $credential.UserName; $domain = $null
if ($user.Contains('\')) { $parts = $user.Split('\', 2); $domain = $parts[0]; $user = $parts[1] }
$handle = [IntPtr]::Zero
try {
    if (![PokaWindowsLogon]::LogonUser($user, $domain, $credential.GetNetworkCredential().Password, 2, 0, [ref]$handle)) { throw 'Windows account credentials were not accepted.' }
} finally { if ($handle -ne [IntPtr]::Zero) { [void][PokaWindowsLogon]::CloseHandle($handle) }; $credential = $null }
Stop-ScheduledTask -TaskName 'Poka Windows Agent' -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
& icacls.exe $InstallPath /inheritance:r /grant:r "${current}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the agent directory.' }
foreach ($file in @('agent.py','requirements.txt','run-agent.ps1','README.md')) { Copy-Item (Join-Path $PSScriptRoot $file) (Join-Path $InstallPath $file) -Force }
if (!$PythonExe) { $PythonExe = & py -3 -c 'import sys; print(sys.executable)' }
& $PythonExe -m venv (Join-Path $InstallPath '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 or later for this account, including the Python launcher.' }
$python = Join-Path $InstallPath '.venv\Scripts\python.exe'
& $python -m pip install -r (Join-Path $InstallPath 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Agent dependency installation failed.' }
& $python -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed.' }
$certPath = ''; $keyPath = ''
if ($Certificate -or $PrivateKey) {
    $certPath = Join-Path $InstallPath 'certificate.pem'; $keyPath = Join-Path $InstallPath 'private-key.pem'
    Copy-Item $Certificate $certPath -Force; Copy-Item $PrivateKey $keyPath -Force
}
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
$token = [Convert]::ToBase64String($bytes)
ConvertTo-SecureString $token -AsPlainText -Force | Export-Clixml (Join-Path $InstallPath 'token.xml')
@{listen=$Listen;port=$Port;certificate=$certPath;privateKey=$keyPath;account=$current} | ConvertTo-Json | Set-Content (Join-Path $InstallPath 'config.json') -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallPath 'run-agent.ps1')`"" -WorkingDirectory $InstallPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $current
$principal = New-ScheduledTaskPrincipal -UserId $current -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Poka Windows Agent' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
if ($Listen -eq '0.0.0.0') {
    Get-NetFirewallRule -DisplayName 'Poka Windows Agent' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'Poka Windows Agent' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $AllowedBackendAddress -Profile Any | Out-Null
}
Start-ScheduledTask -TaskName 'Poka Windows Agent'
# Display once for entering into Poka Settings > Computer. Never place in a log or command argument.
Write-Host 'Windows agent installed. Save this token in your password manager and enter it in Poka Settings > Computer.'
Write-Host "Agent token: $token"
Write-Host "Account: $current"
Write-Host "Port: $Port"
Write-Host 'The desktop account must stay signed in and unlocked for screen and input actions.'
$token = $null
