@echo off
echo Checking for updated index.html in Downloads...

set DOWNLOADS=%USERPROFILE%\Downloads
set APP=C:\Users\sctr1\wh-app

if exist "%DOWNLOADS%\index.html" (
    echo Found index.html in Downloads - copying to app folder...
    copy /Y "%DOWNLOADS%\index.html" "%APP%\index.html"
    echo Done! Deleting from Downloads to keep things tidy...
    del "%DOWNLOADS%\index.html"
) else (
    echo No new index.html found in Downloads, using existing file.
)

echo Starting Mobile server...
start "Mobile Server" cmd /c "cd /d %APP% && python -m http.server 3001"
timeout /t 2 /nobreak >nul
start chrome "https://claude.ai/project/019cf3cf-c948-73e5-b819-4c93735db8ca"
start chrome "http://localhost:3001"
