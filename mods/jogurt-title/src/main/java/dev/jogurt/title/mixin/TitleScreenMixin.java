package dev.jogurt.title.mixin;

import dev.jogurt.title.TitleScreenHooks;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {

  protected TitleScreenMixin(Text title) {
    super(title);
  }

  @Inject(method = "init", at = @At("RETURN"))
  private void jogurt$afterInit(CallbackInfo ci) {
    TitleScreenHooks.mark(this);

    List<ClickableWidget> main = new ArrayList<>();
    List<ClickableWidget> side = new ArrayList<>();

    for (var c : this.children()) {
      if (!(c instanceof ClickableWidget w)) continue;
      if (!(w instanceof ButtonWidget)) continue;
      String msg = w.getMessage().getString().toLowerCase(Locale.ROOT);
      // Hide Realms — Dawn-style home has no Realms row
      if (msg.contains("realm")) {
        w.visible = false;
        w.active = false;
        continue;
      }
      if (w.getWidth() >= 80) main.add(w);
      else side.add(w);
    }

    int cx = this.width / 2;
    int bw = 200;
    int startY = this.height / 2 - 20;
    int gap = 28;
    int i = 0;
    for (ClickableWidget w : main) {
      w.setWidth(bw);
      w.setPosition(cx - bw / 2, startY + i * gap);
      i++;
    }
  }

  @Inject(method = "render", at = @At("TAIL"))
  private void jogurt$afterRender(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
    TitleScreenHooks.renderOverlay(this, context, mouseX, mouseY, delta);
  }
}
