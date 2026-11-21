@echo off
REM Shortcut: real script lives in mods\jogurt-title\
cd /d "%~dp0"
if not exist "mods\jogurt-title\build-mod.bat" (
  echo Missing mods\jogurt-title\build-mod.bat
  echo Make sure you extracted the full JogurtClient folder from the zip.
  pause
  exit /b 1
)
call "mods\jogurt-title\build-mod.bat"
