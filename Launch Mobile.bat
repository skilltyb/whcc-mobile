@echo off
echo Starting Mobile server...
start "Mobile Server" cmd /c "cd /d C:\Users\sctr1\wh-app && python -m http.server 3001"
timeout /t 2 /nobreak >nul
start chrome "https://claude.ai/project/019cf3cf-c948-73e5-b819-4c93735db8ca"
start chrome "http://localhost:3001"
