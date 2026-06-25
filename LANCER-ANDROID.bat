@echo off
title Lancer app sur emulateur Android
cd /d "%~dp0"

REM Java correct (sinon Gradle plante en silence)
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%LOCALAPPDATA%\Android\Sdk\platform-tools;%LOCALAPPDATA%\Android\Sdk\emulator;%PATH%"

echo.
echo [1/4] Build du site web...
call ionic build
if errorlevel 1 goto erreur

echo.
echo [2/4] Copie vers Android...
call npx cap sync android
if errorlevel 1 goto erreur

echo.
echo [3/4] Compilation APK (1ere fois = long, normal)...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto erreur
cd ..

echo.
echo [4/4] Demarrage emulateur + installation...
adb devices | findstr /i "emulator device" >nul
if errorlevel 1 (
  echo Emulateur pas encore pret - demarrage...
  start "" "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -avd Pixel_9_Pro_XL -gpu swiftshader_indirect
  echo Attends 60 secondes que l'ecran Android s'affiche...
  timeout /t 60 /nobreak >nul
)

:attente
adb devices | findstr /i "device" | findstr /v "List" >nul
if errorlevel 1 (
  echo Encore en attente de l'emulateur...
  timeout /t 5 /nobreak >nul
  goto attente
)

adb install -r android\app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n io.ionic.starter/.MainActivity

echo.
echo ========================================
echo   TERMINE. Regarde la fenetre emulateur.
echo   L'app s'appelle "app_mobile" ou "Ionic App"
echo ========================================
pause
exit /b 0

:erreur
echo.
echo ERREUR - copie ce message et envoie-le.
pause
exit /b 1
