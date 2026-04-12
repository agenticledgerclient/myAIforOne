# MyAIforOne system tray indicator for Windows
# Run: powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts\tray-indicator.ps1
# Provides service control via right-click menu and green/red status icon.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Icon generation (green/red circle, no external file needed) ──────────
function New-CircleIcon([System.Drawing.Color]$color) {
    $bmp = New-Object System.Drawing.Bitmap(16, 16)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush($color)
    $g.FillEllipse($brush, 1, 1, 14, 14)
    $brush.Dispose()
    $g.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    return $icon
}

$greenIcon = New-CircleIcon ([System.Drawing.Color]::FromArgb(74, 222, 128))
$redIcon   = New-CircleIcon ([System.Drawing.Color]::FromArgb(239, 68, 68))

# ── Tray icon ────────────────────────────────────────────────────────────
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $redIcon
$notify.Visible = $true
$notify.Text = "MyAIforOne — Checking..."

# ── Service process management ───────────────────────────────────────────
$script:serviceProc = $null
$taskName = "MyAIforOneGateway"

function Get-ServiceRunning {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:4888/health" -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-ServiceProcess {
    try {
        schtasks /Run /TN $taskName 2>$null
    } catch {
        # Fallback: direct spawn if no scheduled task
        $dataDir = Join-Path $env:APPDATA "MyAIforOneGateway"
        $npxCache = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx" -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName "node_modules\myaiforone\dist\index.js") } |
            Select-Object -First 1
        if ($npxCache) {
            $indexJs = Join-Path $npxCache.FullName "node_modules\myaiforone\dist\index.js"
            $env:MYAGENT_DATA_DIR = $dataDir
            Start-Process -FilePath "node" -ArgumentList $indexJs -WindowStyle Hidden
        }
    }
}

function Stop-ServiceProcess {
    try {
        schtasks /End /TN $taskName 2>$null
    } catch {}
    # Also kill any node processes running index.js
    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*myaiforone*index.js*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

# ── Auto-start registry helpers ──────────────────────────────────────────
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$regName = "MyAIforOne"

function Get-AutoStartEnabled {
    return (Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue) -ne $null
}

function Toggle-AutoStart {
    if (Get-AutoStartEnabled) {
        Remove-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
        $autoStartItem.Text = "Start on Login"
    } else {
        $scriptPath = $MyInvocation.ScriptName
        if (-not $scriptPath) { $scriptPath = $PSCommandPath }
        $cmd = "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
        Set-ItemProperty -Path $regPath -Name $regName -Value $cmd
        $autoStartItem.Text = "Start on Login  ✓"
    }
}

# ── Health poll timer (every 10 seconds) ─────────────────────────────────
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.Add_Tick({
    if (Get-ServiceRunning) {
        $notify.Icon = $greenIcon
        $notify.Text = "MyAIforOne — Running"
        $startItem.Visible = $false
        $stopItem.Visible = $true
        $restartItem.Visible = $true
    } else {
        $notify.Icon = $redIcon
        $notify.Text = "MyAIforOne — Stopped"
        $startItem.Visible = $true
        $stopItem.Visible = $false
        $restartItem.Visible = $false
    }
})
$timer.Start()

# Do an initial check immediately
if (Get-ServiceRunning) {
    $notify.Icon = $greenIcon
    $notify.Text = "MyAIforOne — Running"
}

# ── Context menu ─────────────────────────────────────────────────────────
$menu = New-Object System.Windows.Forms.ContextMenuStrip

# Open MyAIforOne
$openItem = $menu.Items.Add("Open MyAIforOne")
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.Add_Click({ Start-Process "http://localhost:4888/ui" })

$menu.Items.Add("-")

# Restart Service
$restartItem = $menu.Items.Add("Restart Service")
$restartItem.Add_Click({
    Stop-ServiceProcess
    Start-Sleep -Seconds 2
    Start-ServiceProcess
})

# Stop Service
$stopItem = $menu.Items.Add("Stop Service")
$stopItem.Add_Click({ Stop-ServiceProcess })

# Start Service
$startItem = $menu.Items.Add("Start Service")
$startItem.Add_Click({ Start-ServiceProcess })
$startItem.Visible = $false

$menu.Items.Add("-")

# Start on Login
$autoStartItem = $menu.Items.Add($(if (Get-AutoStartEnabled) { "Start on Login  ✓" } else { "Start on Login" }))
$autoStartItem.Add_Click({ Toggle-AutoStart })

$menu.Items.Add("-")

# Exit tray app
$exitItem = $menu.Items.Add("Exit")
$exitItem.Add_Click({
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

# Double-click opens web UI
$notify.Add_DoubleClick({ Start-Process "http://localhost:4888/ui" })

[System.Windows.Forms.Application]::Run()
