@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ========================================
echo  Building jogurt-title Fabric mod
echo  Folder: %CD%
echo ========================================
echo.

java -version 2>&1
if errorlevel 1 (
  echo Java not found. Install Java 21 from https://adoptium.net/
  pause
  exit /b 1
)

if not exist "gradle\wrapper\gradle-wrapper.jar" (
  echo Missing gradle\wrapper\gradle-wrapper.jar
  pause
  exit /b 1
)

echo Running Gradle build...
call gradlew.bat build --no-daemon
if errorlevel 1 (
  echo BUILD FAILED.
  pause
  exit /b 1
)

echo.
echo SUCCESS. Jars in build\libs\:
dir /b build\libs\*.jar
echo.

REM Parent of this folder is mods\  →  mods\jogurt-title.jar
set "DEST=%~dp0..\jogurt-title.jar"
set "COPIED="
for %%F in ("build\libs\*.jar") do (
  echo %%~nxF | findstr /i /c:"sources" /c:"dev" >nul
  if errorlevel 1 (
    copy /Y "%%~fF" "%DEST%" >nul
    if exist "%DEST%" (
      echo Copied %%~nxF
      echo   -^> %DEST%
      set "COPIED=1"
    )
  )
)

if not defined COPIED (
  echo Trying explicit copy...
  if exist "build\libs\jogurt-title-1.0.0.jar" (
    copy /Y "build\libs\jogurt-title-1.0.0.jar" "%DEST%"
  )
)

if exist "%DEST%" (
  echo.
  echo OK — launcher will load: mods\jogurt-title.jar
  echo Play a 1.21.x profile in Jogurt Client.
) else (
  echo.
  echo Could not auto-copy. Manually copy:
  echo   build\libs\jogurt-title-1.0.0.jar
  echo to:
  echo   %DEST%
)

echo.
pause
