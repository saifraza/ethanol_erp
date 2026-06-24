# Factory Server watchdog. Runs every 5 min via scheduled task.
# Restarts the FactoryServer task when EITHER:
#   (a) port 5000 is not listening (process dead), OR
#   (b) port 5000 IS listening but the master-data cache is STALE for too long
#       (process alive, but its cloud DB connection is dead).
#
# Why (a): 2026-04-29 a third-party Oracle backup tool blanket-killed our node.exe.
# The FactoryServer schtask is one-shot (Status=Ready, no auto-restart), so it
# stayed dead for ~2h until a human ran `schtasks /run /tn FactoryServer`.
#
# Why (b): 2026-06-24 the node process stayed up and serving :5000 for 10 days,
# but its Prisma client got stuck on a dead socket ("Can't reach database server"
# while TCP to the DB tested True). The cache froze for ~2h and newly-created POs
# (148/149/150) were invisible at the gate — and the old watchdog saw ":5000 up =
# healthy" and never acted. The in-process auto-reconnect (masterDataCache.ts)
# should self-heal within ~1 min; this is the backstop if that fails.

$ErrorActionPreference = 'SilentlyContinue'

$logDir = 'C:\mspil\factory-server\logs'
$logFile = Join-Path $logDir 'watchdog.log'
$STALE_RESTART_MIN = 8   # restart only if stale beyond this (well past the ~1 min in-process self-heal)

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "$ts $msg"
}

function Invoke-Restart {
    param([string]$reason)
    Write-Log "RESTART triggered: $reason"
    # Belt + braces: stop any zombie/stuck factory node first.
    try {
        & "C:\mspil\factory-server\scripts\stop-factory-node.ps1" 2>&1 | ForEach-Object { Write-Log "stop-factory-node: $_" }
    } catch {
        Write-Log "stop-factory-node failed: $($_.Exception.Message)"
    }
    $result = schtasks /run /tn FactoryServer 2>&1
    Write-Log "schtasks /run output: $result"
    Start-Sleep -Seconds 15
    $up = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
    if (-not $up) {
        Start-Sleep -Seconds 15
        $up = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
    }
    if ($up) { Write-Log "RECOVERED :5000 listening after restart" }
    else { Write-Log "STILL DOWN after 30s -- next watchdog tick will retry" }
}

# ── (a) Process liveness ──
$listening = @(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
if (-not $listening) {
    Write-Log "DOWN :5000 not listening"
    Invoke-Restart "port 5000 not listening"
    exit 0
}

# ── (b) Cloud-connection liveness (cache freshness) ──
# :5000 up != cloud connection up. Check the cache's own staleness signal.
try {
    $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/master-data/status' -TimeoutSec 10
    if ($stat.isStale -and ($stat.ageMinutes -ne $null) -and ($stat.ageMinutes -ge $STALE_RESTART_MIN)) {
        Write-Log ("STALE cache: isStale=true ageMinutes={0} (>= {1}) -- in-process reconnect did not recover; restarting" -f $stat.ageMinutes, $STALE_RESTART_MIN)
        Invoke-Restart ("cache stale {0} min" -f $stat.ageMinutes)
        exit 0
    }
    # Healthy. Log only ~hourly to avoid noise.
    if ((Get-Date).Minute -lt 5) {
        Write-Log ("OK :5000 listening, cache fresh (ageMinutes={0})" -f $stat.ageMinutes)
    }
} catch {
    # Status endpoint unreachable but :5000 listened a moment ago — transient;
    # log and let the next tick decide. Don't restart on a single failed probe.
    Write-Log "status probe failed (no restart): $($_.Exception.Message)"
}

exit 0
