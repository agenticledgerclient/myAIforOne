# Build Windows .exe launcher for MyAIforOne
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-windows-launcher.ps1
# Output: dist\MyAIforOne-Launcher.exe
#
# Creates a self-extracting launcher using PowerShell + .NET compilation.
# No NSIS/Inno required — uses built-in C# compiler.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DistDir = Join-Path $ProjectRoot "dist\launcher"

if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# ── C# source for the launcher exe ───────────────────────────────────────
$csharpSource = @'
using System;
using System.Diagnostics;
using System.Net.Http;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Runtime.InteropServices;

namespace MyAIforOne {
    class Launcher {
        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        static Form splashForm;
        static Label statusLabel;

        [STAThread]
        static void Main() {
            // Hide console window
            var handle = GetConsoleWindow();
            if (handle != IntPtr.Zero) ShowWindow(handle, 0);

            // Check if already running
            try {
                using (var client = new HttpClient()) {
                    client.Timeout = TimeSpan.FromSeconds(2);
                    var r = client.GetStringAsync("http://localhost:4888/health").Result;
                    if (r.Contains("ok")) {
                        Process.Start(new ProcessStartInfo("http://localhost:4888/ui") { UseShellExecute = true });
                        return;
                    }
                }
            } catch { }

            // Check for Node.js
            try {
                var p = new Process();
                p.StartInfo = new ProcessStartInfo("node", "--version") {
                    RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true
                };
                p.Start();
                string version = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit();

                int major = int.Parse(version.TrimStart('v').Split('.')[0]);
                if (major < 22) {
                    MessageBox.Show(
                        "Node.js v22+ is required (you have " + version + ").\n\nClick OK to open the download page.",
                        "MyAIforOne", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    Process.Start(new ProcessStartInfo("https://nodejs.org/en/download") { UseShellExecute = true });
                    return;
                }
            } catch {
                MessageBox.Show(
                    "Node.js is required to run MyAIforOne.\n\nClick OK to open the download page.",
                    "MyAIforOne", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Process.Start(new ProcessStartInfo("https://nodejs.org/en/download") { UseShellExecute = true });
                return;
            }

            // Show splash
            Application.EnableVisualStyles();
            var thread = new Thread(() => {
                splashForm = new Form() {
                    Text = "MyAIforOne",
                    Size = new Size(360, 160),
                    StartPosition = FormStartPosition.CenterScreen,
                    FormBorderStyle = FormBorderStyle.FixedDialog,
                    MaximizeBox = false,
                    MinimizeBox = false,
                    BackColor = Color.FromArgb(15, 15, 26),
                    ForeColor = Color.White
                };
                var titleLabel = new Label() {
                    Text = "MyAIforOne",
                    Font = new Font("Segoe UI", 16, FontStyle.Bold),
                    AutoSize = true,
                    Location = new Point(20, 20),
                    ForeColor = Color.FromArgb(139, 92, 246)
                };
                statusLabel = new Label() {
                    Text = "Starting... this may take a minute on first run.",
                    Font = new Font("Segoe UI", 10),
                    AutoSize = true,
                    Location = new Point(20, 65),
                    ForeColor = Color.FromArgb(180, 180, 200)
                };
                splashForm.Controls.Add(titleLabel);
                splashForm.Controls.Add(statusLabel);
                Application.Run(splashForm);
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            // Launch npx — must route through cmd.exe because npx is a .cmd
            // shim on Windows; CreateProcess cannot execute .cmd files directly.
            var npx = new Process();
            npx.StartInfo = new ProcessStartInfo("cmd.exe", "/c npx myaiforone@latest") {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            try {
                npx.Start();
            } catch (Exception ex) {
                MessageBox.Show(
                    "Failed to start MyAIforOne:\n\n" + ex.Message,
                    "MyAIforOne", MessageBoxButtons.OK, MessageBoxIcon.Error);
                if (splashForm != null && !splashForm.IsDisposed)
                    splashForm.Invoke(new Action(() => splashForm.Close()));
                return;
            }

            // Poll health endpoint
            for (int i = 0; i < 120; i++) {
                Thread.Sleep(1000);
                try {
                    using (var client = new HttpClient()) {
                        client.Timeout = TimeSpan.FromSeconds(2);
                        var r = client.GetStringAsync("http://localhost:4888/health").Result;
                        if (r.Contains("ok")) {
                            if (splashForm != null && !splashForm.IsDisposed) {
                                splashForm.Invoke(new Action(() => splashForm.Close()));
                            }
                            return;
                        }
                    }
                } catch { }
            }

            // Timeout — close splash, let npx continue in background
            if (splashForm != null && !splashForm.IsDisposed) {
                splashForm.Invoke(new Action(() => splashForm.Close()));
            }
        }
    }
}
'@

# ── Compile the exe ───────────────────────────────────────────────────────
$exePath = Join-Path $DistDir "MyAIforOne-Launcher.exe"

# Use the built-in C# compiler from .NET Framework
$cscPath = Join-Path $env:windir "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    $cscPath = Join-Path $env:windir "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (Test-Path $cscPath) {
    $srcFile = Join-Path $DistDir "Launcher.cs"
    Set-Content -Path $srcFile -Value $csharpSource

    & $cscPath /target:winexe /out:$exePath /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll $srcFile 2>&1 | Out-Null

    if (Test-Path $exePath) {
        Remove-Item $srcFile
        Write-Host ""
        Write-Host "  Windows launcher built:"
        Write-Host "     EXE: $exePath"
        Write-Host ""
    } else {
        Write-Host "  Build failed — check that .NET Framework 4.x is installed"
    }
} else {
    # Fallback: save the source for manual compilation
    $srcFile = Join-Path $DistDir "Launcher.cs"
    Set-Content -Path $srcFile -Value $csharpSource
    Write-Host ""
    Write-Host "  C# compiler not found. Source saved to:"
    Write-Host "     $srcFile"
    Write-Host "  Compile with: csc /target:winexe /out:MyAIforOne-Launcher.exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll Launcher.cs"
    Write-Host ""
}
