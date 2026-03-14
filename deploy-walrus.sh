#!/bin/bash
set -e

SITE_OBJECT_ID="0x7a538ca8c822a006210105b7a804842ba62a56510f35a2cf1a67a5e04fec5aba"
SITE_BUILDER="/home/runner/.local/bin/site-builder"
CONFIG="walrus-sites-config.yaml"
DIST="dist/public"
EPOCHS=5
BACKEND_URL="https://www.suibets.com"

echo "========================================"
echo "  SuiBets → Walrus Sites Deploy"
echo "========================================"
echo ""

# Check wallet is set up
if [ ! -f "$HOME/.sui/sui_config/client.yaml" ]; then
  echo "ERROR: Sui wallet not configured."
  echo ""
  echo "To fix, import your admin wallet key:"
  echo "  sui keytool import <YOUR_PRIVATE_KEY> ed25519"
  echo "  sui client switch --env mainnet"
  exit 1
fi

# Check site-builder exists
if [ ! -f "$SITE_BUILDER" ]; then
  echo "ERROR: site-builder not found at $SITE_BUILDER"
  exit 1
fi

echo "Step 1/2 — Building frontend (API base: $BACKEND_URL)..."
VITE_API_BASE_URL="$BACKEND_URL" npx vite build
echo "Build complete."
echo ""

echo "Step 2/2 — Uploading to Walrus Sites ($EPOCHS epochs)..."
"$SITE_BUILDER" \
  --config "$CONFIG" \
  update \
  --epochs "$EPOCHS" \
  "$DIST" \
  "$SITE_OBJECT_ID"

echo ""
echo "========================================"
echo "  Deploy complete!"
echo "  Site: https://suibets.wal.app"
echo "  SuiNS: suibets.sui"
echo "========================================"
