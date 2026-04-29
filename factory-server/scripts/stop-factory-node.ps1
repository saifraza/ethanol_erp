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

if ($killed -eq 0) {
    Write-Host "No factory node processes found (already stopped)"
}

# Brief grace so Windows releases the Prisma DLL handle before redeploy
Start-Sleep -Seconds 3
exit 0
