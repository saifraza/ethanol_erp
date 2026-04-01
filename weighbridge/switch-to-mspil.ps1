# ============================================
# SWITCH TO MSPIL WEIGHBRIDGE (our system)
# Stops WtService, takes COM1, starts our service
# Run as Administrator
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SWITCHING TO MSPIL WEIGHBRIDGE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop WtService (old Oracle system)
Write-Host "[1/4] Stopping WtService (old Oracle)..." -ForegroundColor Yellow
sc.exe stop WTReadingNew 2>$null
Start-Sleep -Seconds 2
# Force kill if still running
$proc = Get-Process -Name WtService -ErrorAction SilentlyContinue
if ($proc) { Stop-Process -Name WtService -Force; Write-Host "  Force killed WtService" -ForegroundColor Red }
sc.exe config WTReadingNew start= disabled
Write-Host "  WtService STOPPED and DISABLED" -ForegroundColor Green

# 2. Set serial mode
Write-Host "[2/4] Setting serial mode..." -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable('WB_PROTOCOL', 'serial', 'Machine')
Write-Host "  WB_PROTOCOL = serial (system env)" -ForegroundColor Green

# 3. Stop our service if running
Write-Host "[3/4] Restarting MSPIL service..." -ForegroundColor Yellow
taskkill /F /IM pythonw.exe 2>$null
taskkill /F /IM python.exe 2>$null
Start-Sleep -Seconds 3
Remove-Item 'C:\mspil\weighbridge\data\weighbridge.pid' -Force -ErrorAction SilentlyContinue

# 4. Start our service
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
$env:WB_PROTOCOL = 'serial'
Start-Process -FilePath 'pythonw' -ArgumentList 'C:\mspil\weighbridge\run.py' -WorkingDirectory 'C:\mspil\weighbridge' -WindowStyle Hidden
Start-Sleep -Seconds 6

# Verify
$weight = Invoke-RestMethod -Uri 'http://localhost:8098/api/weight' -ErrorAction SilentlyContinue
if ($weight) {
    Write-Host "[4/4] MSPIL service running!" -ForegroundColor Green
    Write-Host "  Scale connected: $($weight.connected)" -ForegroundColor $(if($weight.connected){'Green'}else{'Red'})
    Write-Host "  Weight: $($weight.weight) KG" -ForegroundColor Green
} else {
    Write-Host "[4/4] WARNING: Service may not have started. Check logs." -ForegroundColor Red
    Write-Host "  Logs: C:\mspil\weighbridge\logs\weighbridge.log" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  MSPIL WEIGHBRIDGE ACTIVE" -ForegroundColor Green
Write-Host "  Old Oracle system: DISABLED" -ForegroundColor Red
Write-Host "  COM1: Our serial reader" -ForegroundColor Green
Write-Host "  UI: http://localhost:8098" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
