# ============================================
# SWITCH TO ORACLE (old system)
# Stops our service, releases COM1, starts WtService
# Run as Administrator
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SWITCHING TO ORACLE (old system)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop our service
Write-Host "[1/4] Stopping MSPIL service..." -ForegroundColor Yellow
taskkill /F /IM pythonw.exe 2>$null
taskkill /F /IM python.exe 2>$null
Start-Sleep -Seconds 3
Write-Host "  MSPIL service STOPPED" -ForegroundColor Green

# 2. Set file mode (so if our service restarts, it won't grab COM1)
Write-Host "[2/4] Setting file mode..." -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable('WB_PROTOCOL', 'file', 'Machine')
Write-Host "  WB_PROTOCOL = file (system env)" -ForegroundColor Green

# 3. Enable and start WtService
Write-Host "[3/4] Starting WtService (Oracle)..." -ForegroundColor Yellow
sc.exe config WTReadingNew start= auto
sc.exe start WTReadingNew 2>$null
Start-Sleep -Seconds 3
$svc = Get-Service WTReadingNew -ErrorAction SilentlyContinue
Write-Host "  WtService: $($svc.Status)" -ForegroundColor $(if($svc.Status -eq 'Running'){'Green'}else{'Yellow'})

# 4. Restart our service in file mode (runs alongside, no COM1 conflict)
Write-Host "[4/4] Restarting MSPIL in file mode..." -ForegroundColor Yellow
Remove-Item 'C:\mspil\weighbridge\data\weighbridge.pid' -Force -ErrorAction SilentlyContinue
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
$env:WB_PROTOCOL = 'file'
Start-Process -FilePath 'pythonw' -ArgumentList 'C:\mspil\weighbridge\run.py' -WorkingDirectory 'C:\mspil\weighbridge' -WindowStyle Hidden
Start-Sleep -Seconds 5
Write-Host "  MSPIL running in file mode (no COM1 conflict)" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  ORACLE SYSTEM ACTIVE" -ForegroundColor Yellow
Write-Host "  WtService: ENABLED (auto-start)" -ForegroundColor Green
Write-Host "  COM1: WtService (old Oracle)" -ForegroundColor Yellow
Write-Host "  MSPIL: file mode (weight may show 0)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
