@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "ROOT=%CD%"
set "TEMP_DIR=%ROOT%\temp"
set "NODE_SCRIPT=%TEMP_DIR%\start-webconsole-preview.mjs"
set "OUT_LOG=%TEMP_DIR%\webconsole-public.out.log"
set "ERR_LOG=%TEMP_DIR%\webconsole-public.err.log"
set "RUNNER=%TEMP_DIR%\run-webconsole-public.cmd"

if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo [error] node not found on PATH.
  echo Please install Node.js or open this from the bot environment shell.
  pause
  exit /b 1
)

if not exist "%NODE_SCRIPT%" (
  echo [error] missing: %NODE_SCRIPT%
  echo Please run this file from crystelf-plugin-main.
  pause
  exit /b 1
)

del "%OUT_LOG%" >nul 2>nul
del "%ERR_LOG%" >nul 2>nul

(
  echo @echo off
  echo cd /d "%ROOT%"
  echo node "%NODE_SCRIPT%" ^> "%OUT_LOG%" 2^> "%ERR_LOG%"
) > "%RUNNER%"

start "crystelf-webconsole" /min "%RUNNER%"

echo starting web console...
echo root : %ROOT%
echo token: use the web console token configured in plugin settings.
echo firewall: unchanged. Open the port manually only when LAN access is needed.

for /l %%i in (1,1,45) do (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:27891/index.html' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto READY
  timeout /t 1 /nobreak >nul
)

echo console not responding yet.
echo logs: %OUT_LOG%
echo err : %ERR_LOG%
echo.
echo --- stdout tail ---
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%OUT_LOG%') { Get-Content -LiteralPath '%OUT_LOG%' -Tail 30 }"
echo.
echo --- stderr tail ---
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%ERR_LOG%') { Get-Content -LiteralPath '%ERR_LOG%' -Tail 30 }"
pause
exit /b 1

:READY
echo open: http://127.0.0.1:27891/
set "LAN_IP_FILE=%TEMP_DIR%\lan-ip.txt"
del "%LAN_IP_FILE%" >nul 2>nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -and $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '+' } | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { Set-Content -LiteralPath '%LAN_IP_FILE%' -Value $ip -NoNewline }" >nul 2>nul
if exist "%LAN_IP_FILE%" set /p LAN_IP=<"%LAN_IP_FILE%"
del "%LAN_IP_FILE%" >nul 2>nul
if defined LAN_IP echo lan : http://%LAN_IP%:27891/
echo bot plugins: http://127.0.0.1:27891/bot-plugins.html
echo logs: %OUT_LOG%
pause
