# Embed Image — Supernote Plugin

> Vibe-coded with Claude Code. Read the diffs before trusting it on a device you care about.

Adds an **Embed Image** button to the plugins area of the sidebar in the NOTE editor. Tapping it opens a file browser starting at `Document/Images` (auto-created if absent). Tap folders to navigate, **Up** / **Home** to jump around, or **Browse…** to open the device's native file picker — which includes mounted **WebDAV** servers and the **SD card**. Tap a thumbnail to open the preview, adjust, then **Insert** into the current note on the current layer (reposition or resize afterward with the lasso tool).

**Supported formats.** PNG, JPEG, BMP, GIF (first frame), WEBP. PNGs with no adjustments are inserted as-is. Everything else is decoded and re-encoded to PNG in the app cache before being handed to `PluginNoteAPI.insertImage`, which is PNG-only.

**Preview adjustments.**

- **Fade to white** — 0 % = original, 100 % = pure white. For tracing references on e-ink: pick a high fade so your strokes stand out against a ghosted reference.
- **Brightness** — −100 .. +100, linear offset.
- **Contrast** — −100 .. +100, scaled around the midpoint.
- **Gamma** — 0.5 .. 2.0, per-channel LUT.

The preview re-bakes (downsampled to 800 px) ~350 ms after the last slider change to keep e-ink refresh manageable. The full-resolution bake happens on **Insert**.

## Layout

- `PluginConfig.json` — plugin manifest (id, name, icon, version)
- `index.js` — registers the sidebar button via `PluginManager.registerButton(1, ['NOTE'], …)`
- `App.tsx` — top-level router. Hosts `streamConfig` and switches between Browser, Preview, Settings, and Capture screens.
- `src/screens/*.tsx` — one file per screen. `Browser` is the folder navigator + system-picker handoff. `Preview` is the static-image preview. `Settings` configures the Mac capture server. `Capture` is the live-stream screen with start/pause, interval steppers, the adjustment panel, a rolling log, and Insert / Replace-in-place.
- `src/AdjustmentPanel.tsx` — tabbed Fade / Brightness / Contrast / Gamma with one slider visible at a time plus preset chips.
- `src/RangeSlider.tsx` — custom PanResponder-based slider (no extra deps).
- `src/imageProcessor.ts`, `src/storage.ts`, `src/embedTracker.ts` — native-module bindings, persistent config helpers, and the element-tracking layer that powers Replace-in-place via `PluginFileAPI.deleteElements` + `insertElements`.
- `assets/icon.png` — sidebar button icon (pre-rendered from the source SVG)
- `android/` — RN Android shell. `StubPackage` registers the `ImageProcessor` native module (decode → B/C/gamma LUT → white-overlay → PNG bake, with optional downsample for previews, plus `downloadAndProcess` for live streaming and SharedPreferences-backed `getConfigValue`/`setConfigValue`) and forces `buildCustomApkDebug` so the package includes an `app.npk` (required for the plugin's RN runtime to load on-device). `AndroidManifest.xml` declares `android:usesCleartextTraffic="true"` so the plugin can fetch over HTTP on the LAN.
- `macapp/` — the Mac-side Python capture server + Tkinter GUI. See `macapp/README.md`.
- `buildPlugin.sh` — bundles JS + native APK + manifest into `build/outputs/embedimage.snplg`

## Build & install

```bash
npm install
JAVA_HOME=/path/to/jdk-17 ANDROID_HOME=/path/to/android-sdk ./buildPlugin.sh
```

Copy `build/outputs/embedimage.snplg` to the device and install via **Settings → Apps → Plugins → Install**. Bump `versionCode` in `PluginConfig.json` between builds, otherwise the installer keeps the previous install.

## Notes

- True file-mtime sort isn't exposed by the SDK's `FileUtils.listFiles`, so the "Newest"/"Oldest" sorts fall back to filename order. Timestamped filenames (`IMG_20260517_*.png`, etc.) sort the expected way; arbitrary names won't.
- The icon expects a raster image; re-run `rsvg-convert -w 96 -h 96 assets/image-square-svgrepo-com.svg -o assets/icon.png` after editing the source SVG.
