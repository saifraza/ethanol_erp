@echo off
cd /d C:\mspil\factory-server
if not exist logs mkdir logs
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set dt=%%a
set stamp=%dt:~0,8%_%dt:~8,6%
"C:\Program Files\nodejs\node.exe" dist\server.js >> logs\server-%stamp%.log 2>&1
