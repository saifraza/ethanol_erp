# Surgically stop ONLY the factory-server node.exe (the one running dist\server.js).
# Leaves all other node processes alone (Oracle backup tools, restorebackup_*.js, etc.).
#
# Why: 2026-04-29 a third-party Oracle backup tool ran taskkill /F /IM node.exe
# and killed our factory server alongside its own scripts -- ~2h plant outage.
# Our deploy.sh used to do the same thing in reverse. Both sides now kill by
# command-line filter, not by image name.

$ErrorActionPreference = 'SilentlyContinue'

$killed = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'dist\\server\.js' } |
    ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force
            Write-Host ("Killed factory node PID " + $_.ProcessId + " :: " + $_.CommandLine)
            $killed++
        } catch {
            Write-Host ("Failed to kill PID " + $_.ProcessId + " :: " + $_.Exception.Message)
        }
    }

# Reliable fallback: WMI/CIM intermittently fails to enumerate node.exe. Seen
# 2026-06-24 — a stuck 7-day server (PID 5784) survived every CIM-based kill, so
# deploys and watchdog restarts spawned duplicate nodes that crashed on
# EADDRINUSE while the old code kept serving the gate. Kill the ACTUAL :5000
# listener by PID from the TCP stack — but ONLY if it is node.exe, so we never
# touch a non-factory holder of the port.
$owners = @((Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique)
foreach ($procId in $owners) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
        try {
            Stop-Process -Id $procId -Force
            Write-Host ("Killed :5000 owner node PID " + $procId)
            $killed++
        } catch {
            Write-Host ("Failed to kill :5000 owner PID " + $procId + " :: " + $_.Exception.Message)
        }
    } elseif ($proc) {
        Write-Host (":5000 held by non-node '" + $proc.ProcessName + "' (PID " + $procId + ") - left alone")
    }
}

if ($killed -eq 0) {
    Write-Host "No factory node processes found (already stopped)"
}

# Brief grace so Windows releases the Prisma DLL handle + the :5000 socket
Start-Sleep -Seconds 3
exit 0
