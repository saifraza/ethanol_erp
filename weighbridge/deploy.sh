#!/bin/bash
# MSPIL Weighbridge — Remote Deploy via Tailscale
# Usage: ./weighbridge/deploy.sh <tailscale-ip> [windows-user]
# Example: ./weighbridge/deploy.sh 100.x.x.x Administrator

set -e

TAILSCALE_IP="${1:-}"
WIN_USER="${2:-Administrator}"
REMOTE_DIR="C:/mspil/weighbridge"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$TAILSCALE_IP" ]; then
    echo "Usage: $0 <tailscale-ip> [windows-user]"
    echo "Example: $0 100.64.0.10 Administrator"
    exit 1
fi

echo "=== MSPIL Weighbridge Deploy ==="
echo "  Target: $WIN_USER@$TAILSCALE_IP"
echo "  Remote: $REMOTE_DIR"
echo ""

# Step 1: Copy weighbridge files to Windows PC
echo "[1/3] Copying files..."
ssh "$WIN_USER@$TAILSCALE_IP" "powershell -Command \"New-Item -ItemType Directory -Force -Path '$REMOTE_DIR' | Out-Null\""
scp -r "$LOCAL_DIR"/*.py "$WIN_USER@$TAILSCALE_IP:$REMOTE_DIR/"
scp -r "$LOCAL_DIR/templates" "$WIN_USER@$TAILSCALE_IP:$REMOTE_DIR/"
scp -r "$LOCAL_DIR/static" "$WIN_USER@$TAILSCALE_IP:$REMOTE_DIR/" 2>/dev/null || true
scp "$LOCAL_DIR/install.bat" "$WIN_USER@$TAILSCALE_IP:$REMOTE_DIR/"
echo "  Files copied."

# Step 2: Run install (pip install + Task Scheduler)
echo "[2/3] Running install..."
ssh "$WIN_USER@$TAILSCALE_IP" "powershell -Command \"cd '$REMOTE_DIR'; pip install flask pyserial --quiet\""
echo "  Dependencies installed."

# Step 3: Create Task Scheduler job and start service
echo "[3/3] Setting up Windows service..."
ssh "$WIN_USER@$TAILSCALE_IP" "powershell -Command \"
    # Remove old task if exists
    Unregister-ScheduledTask -TaskName 'MSPIL Weighbridge' -Confirm:\$false -ErrorAction SilentlyContinue;

    # Create new scheduled task
    \$action = New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '$REMOTE_DIR/run.py' -WorkingDirectory '$REMOTE_DIR';
    \$trigger = New-ScheduledTaskTrigger -AtStartup;
    \$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0;
    Register-ScheduledTask -TaskName 'MSPIL Weighbridge' -Action \$action -Trigger \$trigger -Settings \$settings -RunLevel Highest -Force;

    # Start it now
    Start-ScheduledTask -TaskName 'MSPIL Weighbridge';
    Write-Host 'Task created and started.';
\""

echo ""
echo "=== Deploy complete! ==="
echo "  Web UI: http://$TAILSCALE_IP:8098"
echo "  Logs:   ssh $WIN_USER@$TAILSCALE_IP then: type $REMOTE_DIR/logs/weighbridge.log"
echo ""
echo "To check status:"
echo "  ssh $WIN_USER@$TAILSCALE_IP \"powershell -Command 'Get-ScheduledTask -TaskName MSPIL* | Select TaskName,State'\""
