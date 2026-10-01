$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$config = Get-Content (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
$secret = Import-Clixml (Join-Path $root 'token.xml')
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $env:POKA_AGENT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
$env:POKA_AGENT_ROOT = Join-Path $root 'data'
$argsList = @('-m', 'uvicorn', 'agent:create_app', '--factory', '--host', $config.listen, '--port', "$($config.port)", '--workers', '1', '--no-access-log')
if ($config.certificate) { $argsList += @('--ssl-certfile', $config.certificate, '--ssl-keyfile', $config.privateKey) }
Set-Location $root
try { & (Join-Path $root '.venv\Scripts\python.exe') @argsList; exit $LASTEXITCODE }
finally { Remove-Item Env:POKA_AGENT_TOKEN -ErrorAction SilentlyContinue }
