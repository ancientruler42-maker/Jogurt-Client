# Jogurt in-game title (Dawn-style)

## Why Minecraft still looks mostly vanilla

The **yogurt logo + JOGURT CLIENT** text comes from the **resource pack** (already working in your screenshot).

The **Dawn-like layout** (hide Realms, side panels, stacked buttons) needs the **Fabric mod**:

```
mods/jogurt-title.jar
```

That jar is **not** shipped pre-built (it must be compiled against Minecraft on your PC).

## Build once (Windows)

1. Install **Java 21** from https://adoptium.net  
2. Double-click:

```
mods\jogurt-title\build-mod.bat
```

3. When it finishes, you should have `mods\jogurt-title.jar`  
4. In Jogurt Client, open your **1.21.x** profile → Play  

The launcher copies the jar into the profile’s `mods` folder automatically.

## Check it loaded

In-game, press the Mods button / Mod Menu — you should see **Jogurt Title**.  
On the title screen you should get left **Jogurt Client** panel, **JGRT** chip, no Realms row, centered buttons.
