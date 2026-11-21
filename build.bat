@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
echo Installing packages...
call npm install
if errorlevel 1 goto fail
if not exist "build" mkdir build
copy /Y "assets\icon.ico" "build\icon.ico" >nul
echo Using icon: build\icon.ico
if exist "dist" (
  echo Cleaning old dist...
  rmdir /S /Q "dist"
)
echo.
echo [1/2] Building Jogurt Client (app files)...
call npm run dist
if errorlevel 1 goto fail

echo.
echo [2/2] Building Setup UI (Kato-style — this is the installer you run)...
pushd installer
call npm install
if errorlevel 1 (popd & goto fail)
if exist "dist" rmdir /S /Q "dist"
call npm run dist
if errorlevel 1 (popd & goto fail)
popd

REM Publish the UI setup as the main Setup next to the portable app
copy /Y "installer\dist\JogurtClient-Setup.exe" "dist\JogurtClient-Setup.exe" >nul

echo.
echo Done. Use THIS file to install / update:
echo.
echo   dist\JogurtClient-Setup.exe     ^<-- modern UI setup (Install / Update / Open)
echo   dist\JogurtClient-Portable.exe  (optional portable app, no installer)
echo.
echo Do NOT look for an old Windows "Next / Cancel" wizard — that NSIS UI is gone.
explorer dist
pause
exit /b 0
:fail
echo.
echo Build failed. Scroll up to see the error.
pause
exit /b 1
