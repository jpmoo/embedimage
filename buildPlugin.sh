#!/usr/bin/env bash
# Build script for the Embed Image Supernote plugin.
# Bundles JS + assets and zips them with PluginConfig.json into dist/embedimage.zip,
# which can be sideloaded via Settings > Apps > Plugins > Install on the device.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
STAGE="$OUT_DIR/stage"
rm -rf "$OUT_DIR"
mkdir -p "$STAGE/assets"

# 1. Bundle JS
mkdir -p "$STAGE/bundle"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output "$STAGE/bundle/index.android.bundle" \
  --assets-dest "$STAGE/bundle/res"

# 2. Copy manifest + plugin assets
cp PluginConfig.json "$STAGE/"
cp -R assets/* "$STAGE/assets/"

# 3. Zip the staged folder
( cd "$STAGE" && zip -qr "$OUT_DIR/embedimage.zip" . )
echo "Built: $OUT_DIR/embedimage.zip"
