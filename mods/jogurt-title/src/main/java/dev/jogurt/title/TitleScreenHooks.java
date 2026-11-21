package dev.jogurt.title;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import net.minecraft.util.Util;

import java.net.URI;
import java.util.IdentityHashMap;
import java.util.Map;

public final class TitleScreenHooks {
  private static final Map<Screen, Boolean> MARKED = new IdentityHashMap<>();

  private TitleScreenHooks() {}

  public static void mark(Screen s) { MARKED.put(s, Boolean.TRUE); }

  public static void renderOverlay(Screen screen, DrawContext ctx, int mouseX, int mouseY, float delta) {
    int w = screen.width;
    int h = screen.height;
    var tr = MinecraftClient.getInstance().textRenderer;

    // Left panel (account / brand)
    int lx = 10, ly = 10, lw = 150, lh = 88;
    fill(ctx, lx, ly, lx + lw, ly + lh, 0xD0121814);
    border(ctx, lx, ly, lx + lw, ly + lh, 0xFF2E4636);
    ctx.drawText(tr, Text.literal("Jogurt Client"), lx + 12, ly + 14, 0xFFB8F0C4, false);
    ctx.drawText(tr, Text.literal("Home"), lx + 12, ly + 30, 0xFF5FD068, false);
    ctx.drawText(tr, Text.literal("Profiles live in"), lx + 12, ly + 52, 0xFF8AA48E, false);
    ctx.drawText(tr, Text.literal("AppData · Jogurt"), lx + 12, ly + 64, 0xFF8AA48E, false);

    // Top-right chip
    String brand = "JGRT";
    int tw = tr.getWidth(brand) + 20;
    int bx = w - tw - 12, by = 12;
    fill(ctx, bx, by, bx + tw, by + 20, 0xD0121814);
    border(ctx, bx, by, bx + tw, by + 20, 0xFF2E4636);
    ctx.drawText(tr, Text.literal(brand), bx + 10, by + 6, 0xFF5FD068, false);

    // Footer replaces Mojang line visually (drawn on top)
    String foot = "Jogurt Client · Fabric";
    int fw = tr.getWidth(foot);
    fill(ctx, w / 2 - fw / 2 - 6, h - 24, w / 2 + fw / 2 + 6, h - 10, 0xA00A100C);
    ctx.drawText(tr, Text.literal(foot), w / 2 - fw / 2, h - 20, 0xFF7A9A82, false);
  }

  public static void openUrl(String url) {
    try { Util.getOperatingSystem().open(URI.create(url)); } catch (Exception ignored) {}
  }

  private static void fill(DrawContext ctx, int x1, int y1, int x2, int y2, int color) {
    ctx.fill(x1, y1, x2, y2, color);
  }

  private static void border(DrawContext ctx, int x1, int y1, int x2, int y2, int color) {
    ctx.fill(x1, y1, x2, y1 + 1, color);
    ctx.fill(x1, y2 - 1, x2, y2, color);
    ctx.fill(x1, y1, x1 + 1, y2, color);
    ctx.fill(x2 - 1, y1, x2, y2, color);
  }
}
