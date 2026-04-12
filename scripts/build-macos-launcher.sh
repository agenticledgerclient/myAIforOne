#!/bin/bash
# Build macOS .app launcher + .dmg for MyAIforOne
# Usage: bash scripts/build-macos-launcher.sh
# Output: dist/MyAIforOne-Launcher.dmg

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST="$PROJECT_ROOT/dist/launcher"
APP="$DIST/MyAIforOne.app"

rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ── Info.plist ────────────────────────────────────────────────────────────
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleName</key><string>MyAIforOne</string>
  <key>CFBundleDisplayName</key><string>MyAIforOne</string>
  <key>CFBundleIdentifier</key><string>com.myaiforone.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# ── launch script ─────────────────────────────────────────────────────────
cat > "$APP/Contents/MacOS/launch" << 'LAUNCH'
#!/bin/bash
# MyAIforOne Launcher — thin wrapper that calls npx myaiforone@latest

# Check for Node.js
if ! command -v node &> /dev/null; then
    osascript -e 'display dialog "Node.js is required to run MyAIforOne.\n\nClick OK to open the download page." buttons {"OK"} default button 1 with title "MyAIforOne" with icon caution'
    open "https://nodejs.org/en/download"
    exit 1
fi

# Check Node version
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
    osascript -e "display dialog \"Node.js v22+ is required (you have v$(node --version)).\n\nClick OK to open the download page.\" buttons {\"OK\"} default button 1 with title \"MyAIforOne\" with icon caution"
    open "https://nodejs.org/en/download"
    exit 1
fi

# Check if already running
if curl -s --max-time 2 http://localhost:4888/health | grep -q "ok" 2>/dev/null; then
    open "http://localhost:4888/ui"
    exit 0
fi

# Show splash notification
osascript -e 'display notification "Starting MyAIforOne..." with title "MyAIforOne" subtitle "This may take a minute on first run"' &

# Run npx (detached so the .app can close)
nohup npx myaiforone@latest > /dev/null 2>&1 &
NPX_PID=$!

# Poll until service is up (max 120 seconds)
for i in $(seq 1 120); do
    if curl -s --max-time 2 http://localhost:4888/health | grep -q "ok" 2>/dev/null; then
        exit 0
    fi
    sleep 1
done

# If we get here, service didn't start — npx is probably still installing
osascript -e 'display notification "Still starting... check your browser in a moment." with title "MyAIforOne"'
exit 0
LAUNCH

chmod +x "$APP/Contents/MacOS/launch"

# ── Icon (use project logo if available, otherwise skip) ──────────────────
LOGO="$PROJECT_ROOT/public/MyAIforOne-logomark-512.svg"
if [ -f "$LOGO" ] && command -v sips &> /dev/null; then
    # Convert SVG to ICNS via temporary PNG (best effort)
    TMPICON=$(mktemp -d)/icon
    mkdir -p "$TMPICON.iconset"
    # sips can't handle SVG directly, so we skip ICNS generation
    # Users can manually add icon.icns to Resources/ later
    echo "  Note: Add icon.icns manually to $APP/Contents/Resources/ for a custom icon"
fi

# ── Build DMG ─────────────────────────────────────────────────────────────
DMG_PATH="$PROJECT_ROOT/dist/MyAIforOne-Launcher.dmg"
if command -v hdiutil &> /dev/null; then
    # Create a temporary DMG with Applications symlink for drag-to-install
    DMG_TMP="$DIST/dmg-staging"
    mkdir -p "$DMG_TMP"
    cp -R "$APP" "$DMG_TMP/"
    ln -s /Applications "$DMG_TMP/Applications"

    hdiutil create -volname "MyAIforOne" -srcfolder "$DMG_TMP" -ov -format UDZO "$DMG_PATH" > /dev/null
    rm -rf "$DMG_TMP"

    echo ""
    echo "  ✅ macOS launcher built:"
    echo "     App: $APP"
    echo "     DMG: $DMG_PATH"
    echo ""
else
    echo ""
    echo "  ✅ macOS .app built: $APP"
    echo "     (hdiutil not available — skipping DMG creation)"
    echo ""
fi
