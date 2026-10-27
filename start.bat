@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 没有找到 Node.js，请先安装：https://nodejs.org
  echo.
  pause
  exit /b 1
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"

echo.
echo   合成多糖 正在启动，浏览器会自动打开 http://127.0.0.1:3000
echo   关闭这个窗口就等于关掉服务器。
echo.
node server.mjs
pause
