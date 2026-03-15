# MyAgent — Windows Service Installer
# Installs the gateway as a Windows Service using node-windows
# Run: powershell -ExecutionPolicy Bypass -File scripts/install-service-windows.ps1

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $projectDir "dist\index.js"
$nodePath = (Get-Command node).Source

Write-Host ""
Write-Host "MyAgent — Windows Service Installer" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if node-windows is installed
$nodeWindowsPath = Join-Path $projectDir "node_modules\node-windows"
if (-not (Test-Path $nodeWindowsPath)) {
    Write-Host "Installing node-windows..." -ForegroundColor Yellow
    Set-Location $projectDir
    npm install node-windows
}

# Check if dist/index.js exists
if (-not (Test-Path $scriptPath)) {
    Write-Host "Building project first..." -ForegroundColor Yellow
    Set-Location $projectDir
    npm run build
}

# Create the service installer script
$installerScript = @"
const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'MyAgent Gateway',
  description: 'Phone-accessible Claude Code agent gateway',
  script: path.resolve('$($scriptPath.Replace('\', '\\'))'),
  nodeOptions: [],
  workingDirectory: path.resolve('$($projectDir.Replace('\', '\\'))'),
  env: [
    { name: 'HOME', value: process.env.USERPROFILE },
    { name: 'USERPROFILE', value: process.env.USERPROFILE },
  ]
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('Service started successfully.');
  console.log('Check Services (services.msc) for "MyAgent Gateway"');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

svc.install();
"@

$tempScript = Join-Path $projectDir "tmp\install-service.cjs"
New-Item -ItemType Directory -Path (Join-Path $projectDir "tmp") -Force | Out-Null
Set-Content -Path $tempScript -Value $installerScript

Write-Host "Installing Windows Service..." -ForegroundColor Green
Set-Location $projectDir
node $tempScript

Write-Host ""
Write-Host "Done! The service 'MyAgent Gateway' should now be running." -ForegroundColor Green
Write-Host "Manage it via: services.msc" -ForegroundColor Gray
Write-Host ""
