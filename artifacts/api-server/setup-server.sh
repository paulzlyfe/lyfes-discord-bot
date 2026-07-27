#!/usr/bin/env bash
# Run this on your Google Cloud VM to set up / update the bot.
set -e

echo "=== Updating yt-dlp ==="
mkdir -p bin
curl -sL -o bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
chmod +x bin/yt-dlp
./bin/yt-dlp --version

echo "=== Installing dependencies ==="
# Run from the monorepo root
cd "$(dirname "$0")/../.."
pnpm install --frozen-lockfile

echo "=== Building ==="
pnpm --filter @workspace/api-server run build

echo "=== Done! Restart your bot process (e.g. pm2 restart bot) ==="
