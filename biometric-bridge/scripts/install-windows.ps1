# biometric-bridge installer for the factory-server PC (Windows).
#
# Run once, from PowerShell (Run as Administrator), in the bridge folder:
#   cd C:\mspil\biometric-bridge
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#
# What it does:
#   1. Verifies Python 3.10+ is on PATH (errors out if not -- install via
#      https://www.python.org/downloads/windows/ first; tick "Add to PATH").
#   2. Creates / refreshes the .venv with requirements.txt deps (pyzk + fastapi).
#   3. Generates a random BIOMETRIC_BRIDGE_KEY into .env if one doesn't exist.
#   4. Punches a Windows Firewall hole on TCP 5005 so the cloud (via Tailscale)
#      can reach the bridge.
#
# It does NOT register the scheduled task -- run register-task.ps1 separately
# after this completes successfully.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[install] working dir: $root"

# 1. Python check
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $pythonCmd) {
    Write-Error "Python not found on PATH. Install from python.org (3.10+) and tick 'Add Python to PATH' during install."
    exit 1
}

$pythonVersion = & $pythonCmd.Source --version 2>&1
Write-Host "[install] python: $pythonVersion ($($pythonCmd.Source))"

# 2. venv
$venvPath = Join-Path $root '.venv'
if (-not (Test-Path $venvPath)) {
    Write-Host "[install] creating venv at $venvPath"
    & $pythonCmd.Source -m venv $venvPath
} else {
    Write-Host "[install] venv exists, refreshing deps"
}

$venvPython = Join-Path $venvPath 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Error "venv python not found at $venvPython -- install failed."
    exit 1
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements.txt

# 3. .env key
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
    Add-Type -AssemblyName System.Web
    $key = [System.Web.Security.Membership]::GeneratePassword(48, 0) -replace '[^a-zA-Z0-9]', ''
    if ($key.Length -lt 32) { $key = $key + (Get-Random -Maximum 99999999).ToString() }
    "BIOMETRIC_BRIDGE_KEY=$key" | Out-File -FilePath $envFile -Encoding ascii
    Write-Host "[install] wrote .env with new BIOMETRIC_BRIDGE_KEY"
    Write-Host "[install] *** COPY THIS KEY (set BIOMETRIC_BRIDGE_KEY env var on factory-server + Railway): $key"
} else {
    Write-Host "[install] .env already exists, leaving alone"
}

# 4. Firewall rule
$rule = Get-NetFirewallRule -DisplayName 'BiometricBridge :5005' -ErrorAction SilentlyContinue
if (-not $rule) {
    Write-Host "[install] adding firewall rule TCP 5005 inbound"
    New-NetFirewallRule -DisplayName 'BiometricBridge :5005' `
        -Direction Inbound -Protocol TCP -LocalPort 5005 -Action Allow `
        -Profile Domain,Private | Out-Null
} else {
    Write-Host "[install] firewall rule already in place"
}

Write-Host ""
Write-Host "[install] [OK] done. Next steps:"
Write-Host "  1. Run scripts\register-task.ps1 to register the BiometricBridge scheduled task + watchdog."
Write-Host "  2. On Railway, set BIOMETRIC_BRIDGE_URL=http://<factory-tailscale-ip>:5005 and BIOMETRIC_BRIDGE_KEY (from .env above)."
Write-Host "  3. Hit /api/biometric/bridge-health from the cloud admin to verify."
