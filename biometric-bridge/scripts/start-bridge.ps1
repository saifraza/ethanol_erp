# Run the biometric-bridge in the foreground.
# Used by the BiometricBridge scheduled task -- schtasks runs this script as
# Administrator at boot, the script blocks on uvicorn, and the task stays
# Running. The watchdog (watchdog.ps1) restarts the schtask if uvicorn dies.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Logs go next to scripts/, rotated by date so we never blow disk
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$datestamp = Get-Date -Format 'yyyy-MM-dd'
$logFile = Join-Path $logDir "bridge-$datestamp.log"

# Load .env (BIOMETRIC_BRIDGE_KEY)
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].+=' } | ForEach-Object {
        $pair = $_ -split '=', 2
        if ($pair.Length -eq 2) {
            [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), 'Process')
        }
    }
}

if (-not $env:BIOMETRIC_BRIDGE_KEY) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) FATAL: BIOMETRIC_BRIDGE_KEY missing -- check .env"
    exit 1
}

$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) FATAL: venv missing at $venvPython -- run install-windows.ps1 first"
    exit 1
}

Add-Content -Path $logFile -Value "$(Get-Date -Format o) starting uvicorn on :5005"

# Start-Process with explicit stream redirects -- the older `*>>` operator
# silently dropped stderr when run as SYSTEM via schtasks, which made
# uvicorn errors invisible. Use side files (Start-Process -Redirect* truncates)
# and concat them back into the main log once uvicorn exits. Foreground-wait
# so the schtask stays in Running state while uvicorn is alive.
$tmpOut = "$logFile.uv.out"
$tmpErr = "$logFile.uv.err"
$proc = Start-Process -FilePath $venvPython `
    -ArgumentList "-m","uvicorn","bridge:app","--host","0.0.0.0","--port","5005" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $tmpOut `
    -RedirectStandardError $tmpErr `
    -PassThru -NoNewWindow -Wait

Add-Content -Path $logFile -Value "$(Get-Date -Format o) uvicorn exited with code $($proc.ExitCode)"
foreach ($pair in @(@{Label='--- stdout ---'; Path=$tmpOut}, @{Label='--- stderr ---'; Path=$tmpErr})) {
    if (Test-Path $pair.Path) {
        Add-Content -Path $logFile -Value $pair.Label
        Get-Content $pair.Path | ForEach-Object { Add-Content -Path $logFile -Value $_ }
        Remove-Item $pair.Path -ErrorAction SilentlyContinue
    }
}
exit $proc.ExitCode
