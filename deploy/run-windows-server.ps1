$ErrorActionPreference = 'Stop'
$config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
foreach ($entry in $config.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process') }
Set-Location (Join-Path $PSScriptRoot 'server')
& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') -m uvicorn app.main:app --host 127.0.0.1 --port 18400 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1
exit $LASTEXITCODE
