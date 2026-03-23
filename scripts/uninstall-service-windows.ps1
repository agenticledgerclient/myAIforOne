# MyAgent — Windows Task Scheduler Uninstaller
# Run: powershell -ExecutionPolicy Bypass -File scripts/uninstall-service-windows.ps1

$ErrorActionPreference = "Stop"
$TaskName = "MyAgentGateway"

Write-Host ""
Write-Host "MyAgent — Uninstalling Windows Service" -ForegroundColor Yellow
Write-Host ""

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    # Stop it if running
    schtasks /End /TN $TaskName 2>$null
    Start-Sleep -Seconds 1

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[OK] Task '$TaskName' has been removed." -ForegroundColor Green
} else {
    Write-Host "[INFO] Task '$TaskName' not found — nothing to remove." -ForegroundColor Gray
}

Write-Host ""
