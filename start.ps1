# ArchonIDE Startup Script
# Kills any existing processes on ports 9399 (sidecar) and 1420 (Vite), then starts fresh.

$ErrorActionPreference = "Continue"

$SIDECAR_PORT = 9399
$VITE_PORT = 1420
$ROOT = $PSScriptRoot

function Kill-PortProcess {
    param([int]$Port)
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Killing $($proc.ProcessName) (PID $pid) on port $Port" -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 500
    } else {
        Write-Host "  Port $Port is free" -ForegroundColor DarkGray
    }
}

# --- Cleanup ---
Write-Host "`n=== ArchonIDE Startup ===" -ForegroundColor Cyan
Write-Host "`nChecking for existing processes..." -ForegroundColor White

Write-Host "  Sidecar (port $SIDECAR_PORT):" -NoNewline
Kill-PortProcess -Port $SIDECAR_PORT

Write-Host "  Vite    (port $VITE_PORT):" -NoNewline
Kill-PortProcess -Port $VITE_PORT

# --- Install dependencies if needed ---
if (-not (Test-Path "$ROOT\sidecar\node_modules")) {
    Write-Host "`nInstalling sidecar dependencies..." -ForegroundColor White
    Push-Location "$ROOT\sidecar"
    npm install
    Pop-Location
}

if (-not (Test-Path "$ROOT\app\node_modules")) {
    Write-Host "`nInstalling app dependencies..." -ForegroundColor White
    Push-Location "$ROOT\app"
    npm install
    Pop-Location
}

# --- Start sidecar ---
Write-Host "`nStarting sidecar (WebSocket on port $SIDECAR_PORT)..." -ForegroundColor Green
$sidecarJob = Start-Process -FilePath "cmd" `
    -ArgumentList "/c cd /d `"$ROOT\sidecar`" && npx tsx watch src/index.ts" `
    -PassThru -WindowStyle Normal

Write-Host "  Sidecar PID: $($sidecarJob.Id)" -ForegroundColor DarkGray

# Give sidecar a moment to bind its port
Start-Sleep -Seconds 2

# --- Start Tauri dev (Rust + Vite) ---
Write-Host "Starting Tauri dev (Vite on port $VITE_PORT + Rust shell)..." -ForegroundColor Green
$tauriJob = Start-Process -FilePath "cmd" `
    -ArgumentList "/c cd /d `"$ROOT\app`" && npx tauri dev" `
    -PassThru -WindowStyle Normal

Write-Host "  Tauri PID: $($tauriJob.Id)" -ForegroundColor DarkGray

Write-Host "`n=== Ready ===" -ForegroundColor Cyan
Write-Host "  Sidecar:  ws://localhost:$SIDECAR_PORT"
Write-Host "  Frontend: http://localhost:$VITE_PORT"
Write-Host "  Press Ctrl+C in each window to stop.`n"
