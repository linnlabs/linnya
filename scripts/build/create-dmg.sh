#!/bin/bash
set -euo pipefail

# --- Configuration ---
APP_NAME="林芽"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
ARCH="arm64"
SIGN_IDENTITY="${LINNYA_MAC_DMG_SIGN_IDENTITY:-}"
ALLOW_AD_HOC="${LINNYA_MAC_DMG_ALLOW_AD_HOC:-0}"
HEADLESS_MODE="${LINNYA_MAC_DMG_HEADLESS:-0}"

# --- Paths ---
BUILD_DIR="${ROOT_DIR}/dist_build/dist_electron"
SOURCE_DIR="${BUILD_DIR}/mac-arm64"
SRC_APP="${SOURCE_DIR}/${APP_NAME}.app"
FINAL_DMG="${BUILD_DIR}/${APP_NAME}-${VERSION}-${ARCH}.dmg"
DMG_BACKGROUND="${ROOT_DIR}/build/assets/dmg-background.png" # Optional: create this file for a custom background

# --- Pre-flight Check ---
if ! command -v create-dmg &> /dev/null
then
    echo "Error: create-dmg command not found."
    echo "Please install it first by running: brew install create-dmg"
    exit 1
fi

if [ -z "$SIGN_IDENTITY" ]; then
    echo "Error: LINNYA_MAC_DMG_SIGN_IDENTITY is required."
    echo "Use '-' only for a local ad-hoc package; formal releases must provide the Developer ID identity."
    exit 1
fi

if [ "$SIGN_IDENTITY" = "-" ] && [ "$ALLOW_AD_HOC" != "1" ]; then
    echo "Error: ad-hoc DMG signing is only allowed by the explicit local validation build."
    exit 1
fi

if [ "$HEADLESS_MODE" != "0" ] && [ "$HEADLESS_MODE" != "1" ]; then
    echo "Error: LINNYA_MAC_DMG_HEADLESS must be 0 or 1."
    exit 1
fi

if [ ! -d "$SRC_APP" ]; then
    echo "Error: Source app not found at ${SRC_APP}"
    echo "Please ensure you have run the build and notarization steps first."
    exit 1
fi

echo "✅ Pre-flight checks passed. Creating final DMG with create-dmg..."

# --- Main Script ---

DMG_OPTIONS=(
  --overwrite
  --volname "${APP_NAME}"
  --window-pos 200 120
  --window-size 600 420
  --icon-size 100
  --icon "${APP_NAME}.app" 200 250
  --hide-extension "${APP_NAME}.app"
  --app-drop-link 400 250
  --codesign "$SIGN_IDENTITY"
)

if [ "$HEADLESS_MODE" = "1" ]; then
  # create-dmg 的官方无界面模式只跳过 Finder AppleScript，适合 CI/Agent 验真。
  # 正式发布默认仍执行窗口、图标位置和背景的视觉整理。
  DMG_OPTIONS+=(--skip-jenkins)
fi

if [ -f "$DMG_BACKGROUND" ]; then
  DMG_OPTIONS+=(--background "$DMG_BACKGROUND")
else
  echo "ℹ️ No background image found at ${DMG_BACKGROUND}. Creating DMG without a background."
fi

# SOURCE_DIR 由 electron-builder 创建，当前合同要求其顶层只包含目标 .app。
# 传入 .app 自身会让 hdiutil 把 bundle 内部内容放到镜像根目录。
create-dmg "${DMG_OPTIONS[@]}" "$FINAL_DMG" "$SOURCE_DIR"

echo "🎉 All done! Final DMG is ready at: ${FINAL_DMG}"
