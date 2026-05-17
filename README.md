# Embed Image — Supernote Plugin

Adds an **Embed Image** button to the plugins area of the sidebar in the NOTE editor. Tapping it opens a browser of images from `Document/Images` (auto-created if absent) with thumbnails, filenames, and a sort selector (Newest — default, Oldest, Name). Selecting an image inserts it into the current note.

## Layout

- `PluginConfig.json` — plugin manifest (id, name, icon, version)
- `index.js` — registers the sidebar button via `PluginManager.registerButton(1, ['NOTE'], …)`
- `App.tsx` — full-screen browser UI (thumbnail grid + sort)
- `assets/icon.png` — sidebar button icon (rendered from `image-square-svgrepo-com.svg`)
- `buildPlugin.sh` — bundles JS + manifest into `dist/embedimage.zip`

## Build & install

```bash
npm install
./buildPlugin.sh
```

Copy `build/outputs/embedimage.snplg` to the device and install via **Settings → Apps → Plugins → Install**.

## Notes

- Uses `sn-plugin-lib`'s `PluginNoteAPI.insertImage(path)` (PNG-oriented; JPEGs generally work but transcode to PNG if a particular image is rejected).
- The Supernote plugin runtime expects a raster icon, so the source SVG is pre-rendered to `assets/icon.png` (96×96). Re-run `rsvg-convert -w 96 -h 96 assets/image-square-svgrepo-com.svg -o assets/icon.png` after editing the SVG.
- `READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES` must be declared in the generated `android/app/src/main/AndroidManifest.xml` (added when you scaffold the native shell with the SDK template).
