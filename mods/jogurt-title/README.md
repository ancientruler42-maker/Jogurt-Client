# Jogurt Title (Fabric mod)

Dawn-inspired **title screen** for Jogurt Client on Minecraft **1.21.x**.

## What it does

- Dark side panel + **Jogurt Client** branding on the home screen  
- Centers/restyles the main menu button stack (closer to Dawn’s layout)  
- Footer line: `Jogurt Client · Fabric`  

## What it is not

Dawn is a full custom client (Discord panels, cosmetics store, partnered servers, live widgets). Those need their own backends and a much larger mod/client. This mod is the **visual home-screen shell** you can extend.

## Build

Needs **Java 21+** and network (downloads Minecraft + mappings once).

```bat
cd mods\jogurt-title
build-mod.bat
```

Or with Gradle:

```bat
gradle wrapper --gradle-version 8.11.1
gradlew.bat build
```

Jar appears in `build\libs\`. Jogurt Client copies it into the profile’s `mods` folder on launch (1.21.x only).

You can also drop a built jar at:

- `mods/jogurt-title.jar`  
- or `assets/mods/jogurt-title.jar`  

## Extend

- `TitleScreenMixin` — button layout + overlay draw  
- `TitleScreenHooks` — left panel / top brand chip drawing  

Add buttons that open URLs (Discord, store) with `TitleScreenHooks.openUrl(...)`.
