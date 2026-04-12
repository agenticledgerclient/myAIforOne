# MyAgent — Windows Task Scheduler Installer
# Registers the gateway to run at login via Windows Task Scheduler.
# Run: powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1
#
# To uninstall: powershell -ExecutionPolicy Bypass -File scripts\uninstall-service-windows.ps1

$ErrorActionPreference = "Stop"
$TaskName = "MyAIforOneGateway"

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $projectDir "dist\index.js"

Write-Host ""
Write-Host "MyAgent — Windows Service Installer" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if Node.js is installed
try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $nodeVersion = & node --version
    Write-Host "`[OK`] Node.js found: $nodeVersion ($nodePath)" -ForegroundColor Green
} catch {
    Write-Host '[ERROR] Node.js is not installed or not in PATH.' -ForegroundColor Red
    Write-Host '        Install from https://nodejs.org/ and try again.' -ForegroundColor Yellow
    exit 1
}

# 2. Check if dist/index.js exists, build if not
if (-not (Test-Path $scriptPath)) {
    Write-Host '[INFO] dist/index.js not found — building project...' -ForegroundColor Yellow
    Set-Location $projectDir
    npm run build
    if (-not (Test-Path $scriptPath)) {
        Write-Host '[ERROR] Build failed — dist/index.js still missing.' -ForegroundColor Red
        exit 1
    }
    Write-Host '[OK] Build complete.' -ForegroundColor Green
} else {
    Write-Host '[OK] dist/index.js found.' -ForegroundColor Green
}

# 3. Remove existing task if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "`[INFO`] Removing existing '$TaskName' task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# 4. Create the scheduled task
Write-Host "`[INFO`] Creating Task Scheduler entry '$TaskName'..." -ForegroundColor Green

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$scriptPath`"" `
    -WorkingDirectory $projectDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "MyAgent — Phone-accessible Claude Code agent gateway" | Out-Null

Write-Host ""
Write-Host "===== SUCCESS =====" -ForegroundColor Green
Write-Host "Task '$TaskName' registered to run at login." -ForegroundColor Green
Write-Host ""
Write-Host "Commands:" -ForegroundColor Cyan
Write-Host "  Start now:   schtasks /Run /TN $TaskName" -ForegroundColor Gray
Write-Host "  Stop:        schtasks /End /TN $TaskName" -ForegroundColor Gray
Write-Host "  Status:      schtasks /Query /TN $TaskName" -ForegroundColor Gray
Write-Host "  Uninstall:   powershell -File scripts\uninstall-service-windows.ps1" -ForegroundColor Gray
Write-Host ""

# 5. Show status
schtasks /Query /TN $TaskName /FO LIST
