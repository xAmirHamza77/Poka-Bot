$ErrorActionPreference = 'Stop'
Write-Host 'Poka Windows Agent Setup'
Write-Host '1. Poka backend runs on this Windows machine'
Write-Host '2. Poka backend runs on another server'
$mode = Read-Host 'Choose 1 or 2'
if ($mode -eq '1') { & (Join-Path $PSScriptRoot 'install.ps1') }
elseif ($mode -eq '2') {
    $certificate = Read-Host 'Trusted TLS full-chain PEM certificate path'
    $key = Read-Host 'TLS private key PEM path'
    $allowed = (Read-Host 'Poka backend IP addresses, separated by commas').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    & (Join-Path $PSScriptRoot 'install.ps1') -Listen 0.0.0.0 -Certificate $certificate -PrivateKey $key -AllowedBackendAddress $allowed
} else { throw 'Choose 1 or 2.' }
