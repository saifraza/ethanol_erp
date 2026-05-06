# Register the BiometricBridge + BiometricBridgeWatchdog scheduled tasks.
# Run once after install-windows.ps1, from PowerShell as Administrator:
#   cd C:\mspil\biometric-bridge
#   powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
#
# Tasks created:
#   - BiometricBridge          : runs at boot + on demand, executes start-bridge.ps1
#   - BiometricBridgeWatchdog  : runs every 5 min, executes watchdog.ps1
#
# Idempotent: deletes existing tasks of the same name before recreating.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

$startScript = Join-Path $root 'scripts\start-bridge.ps1'
$watchdogScript = Join-Path $root 'scripts\watchdog.ps1'

if (-not (Test-Path $startScript)) { Write-Error "missing $startScript"; exit 1 }
if (-not (Test-Path $watchdogScript)) { Write-Error "missing $watchdogScript"; exit 1 }

# Bridge task — runs at boot, blocks on uvicorn, restarted by watchdog if it dies
Write-Host "[register] BiometricBridge"
schtasks /Delete /TN BiometricBridge /F 2>$null
$bridgeAction = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
schtasks /Create `
    /TN BiometricBridge `
    /TR $bridgeAction `
    /SC ONSTART `
    /RU SYSTEM `
    /RL HIGHEST `
    /F | Out-Null

# Watchdog task — every 5 min, kicks BiometricBridge if port 5005 is dead
Write-Host "[register] BiometricBridgeWatchdog"
schtasks /Delete /TN BiometricBridgeWatchdog /F 2>$null
$watchdogAction = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogScript`""
schtasks /Create `
    /TN BiometricBridgeWatchdog `
    /TR $watchdogAction `
    /SC MINUTE /MO 5 `
    /RU SYSTEM `
    /RL HIGHEST `
    /F | Out-Null

Write-Host ""
Write-Host "[register] ✓ tasks registered. Triggering bridge now…"
schtasks /Run /TN BiometricBridge | Out-Null
Start-Sleep -Seconds 5

$listening = @(Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
if ($listening) {
    Write-Host "[register] ✓ bridge listening on :5005"
} else {
    Write-Warning "[register] bridge not yet listening on :5005 — wait 10-15s, then check logs\bridge-<date>.log"
}

Write-Host ""
Write-Host "Verify from this box:"
Write-Host "  curl.exe -s -X POST http://localhost:5005/devices/info -H 'X-Bridge-Key: <key from .env>' -H 'Content-Type: application/json' -d '{\`"device\`":{\`"ip\`":\`"192.168.0.25\`"}}'"
