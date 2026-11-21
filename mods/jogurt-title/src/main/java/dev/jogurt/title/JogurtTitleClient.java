package dev.jogurt.title;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.gui.screen.TitleScreen;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class JogurtTitleClient implements ClientModInitializer {
  public static final String MOD_ID = "jogurt-title";
  public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

  @Override
  public void onInitializeClient() {
    LOGGER.info("Jogurt Title screen active");
    // Hook is primarily via TitleScreenMixin; this confirms load.
    ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
      if (screen instanceof TitleScreen) {
        // Mark for overlay rendering handled in mixin
        TitleScreenHooks.mark(screen);
      }
    });
  }
}
