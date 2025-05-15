#!/bin/bash

# This script creates an .icns file from an SVG for macOS app icons
# Requires ImageMagick and iconutil

# Exit on any error
set -e

# Check for dependencies
if ! command -v convert &> /dev/null; then
  echo "Error: ImageMagick is required but not installed."
  echo "Install with: brew install imagemagick"
  exit 1
fi

if ! command -v iconutil &> /dev/null; then
  echo "Error: iconutil is required (should be pre-installed on macOS)."
  exit 1
fi

# Change to the script directory
cd "$(dirname "$0")"

# Create temporary iconset directory
ICONSET="icon.iconset"
mkdir -p "$ICONSET"

# Convert SVG to PNG at various resolutions
convert -background none "icon.svg" -resize 16x16 "$ICONSET/icon_16x16.png"
convert -background none "icon.svg" -resize 32x32 "$ICONSET/icon_16x16@2x.png"
convert -background none "icon.svg" -resize 32x32 "$ICONSET/icon_32x32.png"
convert -background none "icon.svg" -resize 64x64 "$ICONSET/icon_32x32@2x.png"
convert -background none "icon.svg" -resize 128x128 "$ICONSET/icon_128x128.png"
convert -background none "icon.svg" -resize 256x256 "$ICONSET/icon_128x128@2x.png"
convert -background none "icon.svg" -resize 256x256 "$ICONSET/icon_256x256.png"
convert -background none "icon.svg" -resize 512x512 "$ICONSET/icon_256x256@2x.png"
convert -background none "icon.svg" -resize 512x512 "$ICONSET/icon_512x512.png"
convert -background none "icon.svg" -resize 1024x1024 "$ICONSET/icon_512x512@2x.png"

# Create the icns file
iconutil -c icns "$ICONSET"

# Clean up
rm -rf "$ICONSET"

echo "Icon successfully created at $(pwd)/icon.icns" 