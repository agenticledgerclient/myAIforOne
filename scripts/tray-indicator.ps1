# MyAgent system tray status indicator for Windows
# Run: powershell -WindowStyle Hidden -File scripts/tray-indicator.ps1
# Shows a tray icon with agent count, status, and quick links.

Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.Text = "MyAgent Gateway"

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    try {
        $data = Invoke-RestMethod -Uri "http://localhost:4888/api/dashboard" -TimeoutSec 2
        $count = $data.agents.Count
        $notify.Text = "MyAgent: $count agents running"
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    } catch {
        $notify.Text = "MyAgent: Down"
        $notify.Icon = [System.Drawing.SystemIcons]::Warning
    }
})
$timer.Start()

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add("Open Web UI", $null, { Start-Process "http://localhost:4888/ui" })
$menu.Items.Add("---")
$menu.Items.Add("Start Service", $null, { schtasks /Run /TN MyAgentGateway })
$menu.Items.Add("Stop Service", $null, { schtasks /End /TN MyAgentGateway })
$menu.Items.Add("Restart Service", $null, { schtasks /End /TN MyAgentGateway; Start-Sleep 2; schtasks /Run /TN MyAgentGateway })
$menu.Items.Add("Exit", $null, { $notify.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$notify.ContextMenuStrip = $menu

[System.Windows.Forms.Application]::Run()
