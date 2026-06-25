@echo off
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
echo === Build web ===
call ionic build
if errorlevel 1 exit /b 1

echo === Sync Android ===
call npx cap sync android
if errorlevel 1 exit /b 1

echo === Install et lance sur emulateur ===
call npx cap run android
pause
