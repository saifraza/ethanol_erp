# ============================================
# MSPIL Factory PC Setup Script
# Run as Administrator on any new factory PC
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MSPIL Factory PC Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Install OpenSSH Server
Write-Host "[1/5] Installing OpenSSH Server..." -ForegroundColor Yellow
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 2>$null
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Write-Host "  SSH installed and set to auto-start" -ForegroundColor Green

# 2. Firewall rules
Write-Host "[2/5] Opening firewall ports..." -ForegroundColor Yellow
New-NetFirewallRule -Name 'sshd' -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue 2>$null
New-NetFirewallRule -Name 'MSPIL-Web' -DisplayName 'MSPIL Web Service' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 8098 -ErrorAction SilentlyContinue 2>$null
Write-Host "  Ports 22 (SSH) and 8098 (Web) opened" -ForegroundColor Green

# 3. Disable sleep
Write-Host "[3/5] Disabling sleep and hibernate..." -ForegroundColor Yellow
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
Write-Host "  Sleep and hibernate disabled (24/7 operation)" -ForegroundColor Green

# 4. Set Chrome homepage to factory server
Write-Host "[4/5] Setting up Chrome..." -ForegroundColor Yellow
$regPath = "HKLM:\SOFTWARE\Policies\Google\Chrome"
if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
Set-ItemProperty -Path $regPath -Name "HomepageLocation" -Value "http://192.168.0.10:5000" -ErrorAction SilentlyContinue
Write-Host "  Chrome homepage set to http://192.168.0.10:5000" -ForegroundColor Green

# 5. Show info
Write-Host "[5/5] Collecting system info..." -ForegroundColor Yellow
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
$hostname = hostname
$tailscaleIp = & "C:\Program Files\Tailscale\tailscale.exe" ip -4 2>$null

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Hostname:     $hostname"
Write-Host "  LAN IP:       $ip"
Write-Host "  Tailscale IP: $tailscaleIp"
Write-Host "  SSH:          Port 22 (auto-start)"
Write-Host "  Sleep:        Disabled"
Write-Host ""
Write-Host "  NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Open Chrome -> http://192.168.0.10:5000"
Write-Host "  2. Login with your assigned username/password"
Write-Host "  3. Tell admin the Tailscale IP: $tailscaleIp"
Write-Host ""
Write-Host "  Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
