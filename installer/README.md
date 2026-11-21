# Jogurt Client Setup (UI installer)

Electron-based installer that matches the Jogurt Client look (green theme, animated buttons).

## What it does

- **Fresh install** — copies the built client into `%LOCALAPPDATA%\Jogurt Client`
- **Update / Repair** — if that folder already has `JogurtClient.exe`, the primary button becomes **Update** or **Repair / Reinstall**
- **Keeps profiles** — does not touch `%APPDATA%\.jogurtclient`
- **Launch** after install/update

## Build order

From the repo root:

```bat
build.bat
```

That builds the client into `dist\win-unpacked`, then packs it as `extraResources/payload` into the setup app.

## Dev test (after client build)

```bat
cd installer
npm install
npm start
```

Requires `..\dist\win-unpacked\JogurtClient.exe` from a prior client build.
