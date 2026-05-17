#!/usr/bin/env bash
# Build script for the Embed Image Supernote plugin.
# Bundles JS + assets with PluginConfig.json into build/outputs/embedimage.snplg,
# which can be sideloaded via Settings > Apps > Plugins > Install on the device.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BUILD_DIR="$ROOT/build"
OUT_DIR="$BUILD_DIR/outputs"
STAGE="$BUILD_DIR/stage"
OUT_FILE="$OUT_DIR/embedimage.snplg"

rm -rf "$BUILD_DIR"
mkdir -p "$STAGE/assets" "$STAGE/bundle" "$OUT_DIR"

# 1. Bundle JS
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output "$STAGE/bundle/index.android.bundle" \
  --assets-dest "$STAGE/bundle/res"

# 2. Copy manifest + plugin assets
cp PluginConfig.json "$STAGE/"
cp -R assets/* "$STAGE/assets/"

# 3. Package the staged folder as an .snplg (zip container)
( cd "$STAGE" && zip -qr "$OUT_FILE" . )
echo "Built: $OUT_FILE"
