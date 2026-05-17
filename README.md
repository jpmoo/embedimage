# Embed PNG — Supernote Plugin

Adds an **Embed PNG** button to the plugins area of the sidebar in the NOTE editor. Tapping it opens a browser of PNG files in `Document/Images` (auto-created if absent) with thumbnails, filenames, and a sort selector (Newest — default, Oldest, Name). Selecting a PNG inserts it into the current note on the current layer; reposition or resize it afterward with the lasso tool.

**PNG only.** The Supernote host's image-insert API is built around PNG (the SDK parameter is named `pngPath`). JPEG/WebP files in the directory are ignored. Convert other formats to PNG before dropping them in.

## Layout

- `PluginConfig.json` — plugin manifest (id, name, icon, version)
- `index.js` — registers the sidebar button via `PluginManager.registerButton(1, ['NOTE'], …)`
- `App.tsx` — full-screen picker UI (thumbnail grid + sort)
- `assets/icon.png` — sidebar button icon (pre-rendered from the source SVG)
- `android/` — RN Android shell. An empty `StubPackage` is registered to force `buildCustomApkDebug` so the package includes an `app.npk` (required for the plugin's RN runtime to load on-device)
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
