#!/bin/bash
# Cursor Mobile Companion Server - macOS Uninstall Script
# This script stops and removes the companion server service.

set -e

echo "Uninstalling Cursor Mobile Companion Server..."

PLIST_NAME="com.cursor-mobile.companion"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.cursor-mobile-companion}"

# Stop the service
if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
    echo "Stopping service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Remove plist
if [ -f "$PLIST_PATH" ]; then
    echo "Removing Launch Agent..."
    rm -f "$PLIST_PATH"
fi

echo ""
echo "✅ Service stopped and removed."
echo ""
echo "Note: Server files are still at: $INSTALL_DIR"
echo "      Database is at: $INSTALL_DIR/data/companion.db"
echo ""
read -p "Delete all server files and database? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    echo "✅ All files deleted."
else
    echo "Files preserved. Remove manually if needed:"
    echo "  rm -rf $INSTALL_DIR"
fi
