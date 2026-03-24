@echo off
setlocal

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3000"
set "APP_URL=http://localhost:%PORT%"

start "ChatGPT Export Reader" cmd /c "title ChatGPT Export Reader && cd /d ""%~dp0"" && echo Starting ChatGPT Export Reader... && echo URL: %APP_URL% && echo Press Ctrl+C or close this window to stop the server. && echo. && node server.js"
