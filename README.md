# Embed Image — Supernote Plugin

> Vibe-coded with Claude Code. Read the diffs before trusting it on a device you care about.

Adds an **Embed Image** button to the plugins area of the sidebar in the NOTE editor. Tapping it opens a browser of PNG/JPEG files in `Document/Images` (auto-created if absent) with thumbnails, filenames, and a sort selector (Newest — default, Oldest, Name). Tapping a thumbnail opens a preview with a fade-to-white slider; tap **Insert** to embed it into the current note on the current layer (reposition or resize afterward with the lasso tool).

**Fade slider.** 0 % = original image, 100 % = pure white. Useful for image references on e-ink — pick a high fade so your strokes stand out against a ghosted reference. The fade is baked into a temporary PNG before insert.

**JPEG support.** PNGs are embedded directly when fade = 0. JPEGs (and any image with fade > 0) are decoded and re-encoded as PNG in the app cache before being handed to `PluginNoteAPI.insertImage`, which is PNG-only.

## Layout

- `PluginConfig.json` — plugin manifest (id, name, icon, version)
- `index.js` — registers the sidebar button via `PluginManager.registerButton(1, ['NOTE'], …)`
- `App.tsx` — full-screen picker UI (thumbnail grid + sort, preview with fade slider)
- `assets/icon.png` — sidebar button icon (pre-rendered from the source SVG)
- `android/` — RN Android shell. `StubPackage` registers the `ImageProcessor` native module (Bitmap → white-overlay → PNG bake) and forces `buildCustomApkDebug` so the package includes an `app.npk` (required for the plugin's RN runtime to load on-device)
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
