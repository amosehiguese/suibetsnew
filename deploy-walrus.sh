#!/bin/bash
set -e

SITE_OBJECT_ID="0x7a538ca8c822a006210105b7a804842ba62a56510f35a2cf1a67a5e04fec5aba"
WALRUS_BINARY="$HOME/.local/bin/walrus"
SITE_BUILDER="$HOME/.local/bin/site-builder"
CONFIG="walrus-sites-config.yaml"
DIST="dist/public"
EPOCHS=5
BACKEND_URL="https://www.suibets.com"
PRIVATE_KEY="suiprivkey1qzva0ep786gzsrpdxa7upufsrer0tg5eq8u86tey3x46c86jwl0kqx2h99m"

echo "========================================"
echo "  SuiBets → Walrus Sites Deploy"
echo "========================================"
echo ""

# ── Install walrus binary if missing ───────────────────────────────────────
if [ ! -f "$WALRUS_BINARY" ]; then
  echo "Installing walrus binary..."
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://github.com/MystenLabs/walrus/releases/download/mainnet-v1.43.1/walrus-mainnet-v1.43.1-ubuntu-x86_64.tgz -o /tmp/walrus.tgz
  tar -xzf /tmp/walrus.tgz -C /tmp/
  mv /tmp/walrus "$WALRUS_BINARY"
  chmod +x "$WALRUS_BINARY"
  rm -f /tmp/walrus.tgz
  echo "walrus installed."
fi

# ── Install site-builder if missing ────────────────────────────────────────
if [ ! -f "$SITE_BUILDER" ]; then
  echo "Installing site-builder..."
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://github.com/MystenLabs/walrus-sites/releases/download/mainnet-v2.7.0/site-builder-mainnet-v2.7.0-ubuntu-x86_64.tgz -o /tmp/sb.tgz
  tar -xzf /tmp/sb.tgz -C /tmp/
  mv /tmp/site-builder "$SITE_BUILDER"
  chmod +x "$SITE_BUILDER"
  rm -f /tmp/sb.tgz
  echo "site-builder installed."
fi

# ── Set up walrus client config ─────────────────────────────────────────────
mkdir -p "$HOME/.config/walrus"
cat > "$HOME/.config/walrus/client_config.yaml" << 'WALRUS_CONFIG'
default_context: mainnet
contexts:
  mainnet:
    system_object: "0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2"
    staking_object: "0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904"
    rpc_urls:
      - "https://fullnode.mainnet.sui.io:443"
    communication_config:
      max_concurrent_writes: 5
      max_concurrent_sliver_reads: 5
      max_concurrent_metadata_reads: 5
      max_data_in_flight: 524288000
      reqwest_config:
        total_timeout:
          secs: 180
          nanos: 0
        pool_idle_timeout: null
        http2_keep_alive_timeout:
          secs: 5
          nanos: 0
        http2_keep_alive_interval:
          secs: 30
          nanos: 0
        http2_keep_alive_while_idle: true
WALRUS_CONFIG
echo "Walrus client config ready."

# ── Set up Sui wallet ───────────────────────────────────────────────────────
mkdir -p "$HOME/.sui/sui_config"
node -e "
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRIV_KEY = '${PRIVATE_KEY}';
const { secretKey } = decodeSuiPrivateKey(PRIV_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const address = keypair.getPublicKey().toSuiAddress();

const keystoreEntry = Buffer.concat([Buffer.from([0x00]), Buffer.from(secretKey)]).toString('base64');
const keystorePath = path.join(os.homedir(), '.sui', 'sui_config', 'sui.keystore');
const clientYamlPath = path.join(os.homedir(), '.sui', 'sui_config', 'client.yaml');

fs.writeFileSync(keystorePath, JSON.stringify([keystoreEntry], null, 2));
fs.writeFileSync(clientYamlPath, \`keystore:
  File: \${keystorePath}
envs:
  - alias: mainnet
    rpc: \"https://fullnode.mainnet.sui.io:443\"
    ws: ~
    basic_auth: ~
active_env: mainnet
active_address: \"\${address}\"
\`);
console.log('Wallet ready:', address);
" 2>/dev/null || echo "Wallet already configured."
echo ""

# ── Build frontend ──────────────────────────────────────────────────────────
echo "Step 1/2 — Building frontend (API base: $BACKEND_URL)..."
VITE_API_BASE_URL="$BACKEND_URL" npx vite build
echo "Build complete. Size: $(du -sh dist/public | cut -f1)"
echo ""

# ── Upload to Walrus Sites ──────────────────────────────────────────────────
echo "Step 2/2 — Uploading to Walrus Sites ($EPOCHS epochs)..."
echo "Site: $SITE_OBJECT_ID"
echo ""
"$SITE_BUILDER" \
  --config "$CONFIG" \
  update \
  --epochs "$EPOCHS" \
  "$DIST" \
  "$SITE_OBJECT_ID"

echo ""
echo "========================================"
echo "  Deploy complete!"
echo "  Site URL : https://suibets.wal.app"
echo "  SuiNS    : suibets.sui"
echo "========================================"
