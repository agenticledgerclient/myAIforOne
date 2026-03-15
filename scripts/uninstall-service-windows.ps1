# MyAgent — Windows Service Uninstaller
# Run: powershell -ExecutionPolicy Bypass -File scripts/uninstall-service-windows.ps1

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $projectDir "dist\index.js"

Write-Host ""
Write-Host "MyAgent — Uninstalling Windows Service" -ForegroundColor Yellow
Write-Host ""

$uninstallerScript = @"
const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'MyAgent Gateway',
  script: path.resolve('$($scriptPath.Replace('\', '\\'))'),
});

svc.on('uninstall', () => {
  console.log('Service uninstalled.');
});

svc.uninstall();
"@

$tempScript = Join-Path $projectDir "tmp\uninstall-service.cjs"
New-Item -ItemType Directory -Path (Join-Path $projectDir "tmp") -Force | Out-Null
Set-Content -Path $tempScript -Value $uninstallerScript

Set-Location $projectDir
node $tempScript

Write-Host "Done." -ForegroundColor Green
