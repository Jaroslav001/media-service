#!/bin/bash
# =============================================================================
# Media Service — Redeploy Script
# Run as root on the Droplet after pushing code changes
#
# Usage: bash /var/www/media-service/deploy/redeploy.sh
# =============================================================================

set -euo pipefail

cd /var/www/media-service

echo "=== Redeploying media-service ==="

echo "[1/5] Pulling latest code..."
git pull origin main

echo "[2/5] Installing dependencies..."
npm ci --production=false

echo "[3/5] Generating Prisma client..."
npx prisma generate

echo "[4/5] Running migrations..."
npx prisma migrate deploy

echo "[5/5] Building and restarting..."
npm run build
pm2 restart media-service

echo ""
echo "Done! Check status: pm2 status"
echo "Logs: pm2 logs media-service --lines 20"
