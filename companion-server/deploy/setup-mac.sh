#!/bin/bash
# Cursor Mobile Companion Server - macOS Setup Script
# This script installs and configures the companion server as a macOS Launch Agent.

set -e

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Cursor Mobile Companion Server - macOS Setup       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Configuration
INSTALL_DIR="${INSTALL_DIR:-$HOME/.cursor-mobile-companion}"
DATA_DIR="${DATA_DIR:-$HOME/.cursor-mobile-companion/data}"
PORT="${COMPANION_PORT:-24842}"
PLIST_NAME="com.cursor-mobile.companion"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

# Detect node
NODE_PATH=$(which node 2>/dev/null || true)
if [ -z "$NODE_PATH" ]; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   brew install node"
    echo "   or visit https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✓ Found Node.js $NODE_VERSION at $NODE_PATH"

# Check node version (need 18+)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "❌ Node.js 18+ is required (found $NODE_VERSION)"
    exit 1
fi

# Get script directory (where the source code is)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "📁 Source directory: $SERVER_DIR"
echo "📁 Install directory: $INSTALL_DIR"
echo "📁 Data directory: $DATA_DIR"
echo "🔌 Port: $PORT"
echo ""

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR"

# Copy server files
echo "Copying server files..."
cp -r "$SERVER_DIR/src" "$INSTALL_DIR/"
cp "$SERVER_DIR/package.json" "$INSTALL_DIR/"
if [ -f "$SERVER_DIR/package-lock.json" ]; then
    cp "$SERVER_DIR/package-lock.json" "$INSTALL_DIR/"
fi

# Install dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --production --silent 2>&1 | tail -3

# Unload existing service if running
if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
    echo "Stopping existing service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Create the launchd plist
echo "Creating Launch Agent..."
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>src/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>COMPANION_PORT</key>
    <string>$PORT</string>
    <key>COMPANION_DB_PATH</key>
    <string>$DATA_DIR/companion.db</string>
    <key>COMPANION_HOST</key>
    <string>0.0.0.0</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$DATA_DIR/companion.log</string>

  <key>StandardErrorPath</key>
  <string>$DATA_DIR/companion.err</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
EOF

# Load the service
echo "Starting service..."
launchctl load "$PLIST_PATH"

# Wait for startup
sleep 2

# Verify
echo ""
if curl -s "http://localhost:$PORT/health" | grep -q '"ok"' 2>/dev/null; then
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║   ✅ Cursor Mobile Companion is running!             ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""
    echo "  🌐 Server:    http://localhost:$PORT"
    echo "  🔌 WebSocket: ws://localhost:$PORT/ws"
    echo "  💾 Database:  $DATA_DIR/companion.db"
    echo "  📋 Logs:      $DATA_DIR/companion.log"
    echo ""
    echo "  The server will start automatically on login."
    echo ""
    echo "  To stop:    launchctl unload $PLIST_PATH"
    echo "  To restart: launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
    echo "  To remove:  $INSTALL_DIR/deploy/uninstall.sh"
    echo ""
    echo "  Connect your iPhone app to: $(ipconfig getifaddr en0 2>/dev/null || echo 'your-mac-ip'):$PORT"
else
    echo "⚠️  Server may still be starting. Check logs:"
    echo "    tail -f $DATA_DIR/companion.log"
    echo "    tail -f $DATA_DIR/companion.err"
fi
