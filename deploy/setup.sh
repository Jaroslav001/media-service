#!/bin/bash
# =============================================================================
# Media Service — Droplet Setup Script
# Run as root on the media.amaterky.com Droplet
#
# Usage: bash setup.sh
# =============================================================================

set -euo pipefail

echo "=== Media Service Droplet Setup ==="
echo ""

# -------------------------------------------------------------------
# 1. System update
# -------------------------------------------------------------------
echo "[1/9] Updating system packages..."
apt update && apt upgrade -y

# -------------------------------------------------------------------
# 2. Node.js 22 via NodeSource
# -------------------------------------------------------------------
echo "[2/9] Installing Node.js 22..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
fi
echo "Node.js $(node -v) installed"
echo "npm $(npm -v) installed"

# -------------------------------------------------------------------
# 3. PostgreSQL 16
# -------------------------------------------------------------------
echo "[3/9] Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql

# -------------------------------------------------------------------
# 4. Redis
# -------------------------------------------------------------------
echo "[4/9] Installing Redis..."
apt install -y redis-server
systemctl enable redis-server

sed -i 's/^# maxmemory .*/maxmemory 128mb/' /etc/redis/redis.conf
sed -i 's/^maxmemory .*/maxmemory 128mb/' /etc/redis/redis.conf
grep -q '^maxmemory ' /etc/redis/redis.conf || echo 'maxmemory 128mb' >> /etc/redis/redis.conf

sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
sed -i 's/^maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
grep -q '^maxmemory-policy ' /etc/redis/redis.conf || echo 'maxmemory-policy allkeys-lru' >> /etc/redis/redis.conf

systemctl restart redis-server
echo "Redis configured (128mb, allkeys-lru)"

# -------------------------------------------------------------------
# 5. FFmpeg (for video processing)
# -------------------------------------------------------------------
echo "[5/9] Installing FFmpeg..."
apt install -y ffmpeg
echo "FFmpeg $(ffmpeg -version | head -1) installed"

# -------------------------------------------------------------------
# 6. PostgreSQL — create DB and user
# -------------------------------------------------------------------
echo "[6/9] Setting up PostgreSQL database..."
read -sp "Enter a password for the media_user DB user: " DB_PASSWORD
echo ""

sudo -u postgres psql <<SQL
CREATE USER media_user WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE media_service OWNER media_user;
SQL
echo "Database 'media_service' created with user 'media_user'"

# -------------------------------------------------------------------
# 7. Clone and build the app
# -------------------------------------------------------------------
echo "[7/9] Cloning and building media-service..."
mkdir -p /var/www
cd /var/www

if [ -d "media-service" ]; then
    echo "Directory /var/www/media-service already exists — pulling latest..."
    cd media-service
    git pull origin main
else
    git clone https://github.com/Jaroslav001/media-service.git
    cd media-service
fi

npm ci --production=false
npx prisma generate
npm run build
echo "Build complete"

# -------------------------------------------------------------------
# 8. Create .env (interactive)
# -------------------------------------------------------------------
echo "[8/9] Creating .env file..."
read -sp "Enter JWT_SECRET (must match Laravel api/.env): " JWT_SECRET
echo ""
read -p "Enter CORS_ORIGINS (e.g. https://amaterky.com): " CORS_ORIGINS
read -p "Enter S3_ENDPOINT (e.g. https://fra1.digitaloceanspaces.com): " S3_ENDPOINT
read -p "Enter S3_REGION (e.g. fra1): " S3_REGION
read -p "Enter S3_BUCKET (e.g. acko): " S3_BUCKET
read -sp "Enter S3_ACCESS_KEY_ID: " S3_ACCESS_KEY_ID
echo ""
read -sp "Enter S3_SECRET_ACCESS_KEY: " S3_SECRET_ACCESS_KEY
echo ""
read -p "Enter S3_CDN_URL (e.g. https://acko.fra1.cdn.digitaloceanspaces.com): " S3_CDN_URL
read -p "Enter WEBHOOK_DEFAULT_URL (e.g. https://api.amaterky.com/api/internal/media/webhook): " WEBHOOK_DEFAULT_URL
read -sp "Enter WEBHOOK_SECRET (shared with Laravel): " WEBHOOK_SECRET
echo ""

cat > /var/www/media-service/.env <<EOF
PORT=3003
NODE_ENV=production

DATABASE_URL="postgresql://media_user:${DB_PASSWORD}@localhost:5432/media_service"

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=2

JWT_SECRET=${JWT_SECRET}

CORS_ORIGINS=${CORS_ORIGINS}

S3_ENDPOINT=${S3_ENDPOINT}
S3_REGION=${S3_REGION}
S3_BUCKET=${S3_BUCKET}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
S3_CDN_URL=${S3_CDN_URL}

WEBHOOK_DEFAULT_URL=${WEBHOOK_DEFAULT_URL}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
EOF
echo ".env created"

# -------------------------------------------------------------------
# 9. Run Prisma migrations
# -------------------------------------------------------------------
echo "[9/9] Running Prisma migrations..."
cd /var/www/media-service
npx prisma migrate deploy
echo "Migrations complete"

# -------------------------------------------------------------------
# PM2 setup
# -------------------------------------------------------------------
echo ""
echo "=== Setting up PM2 ==="
npm install -g pm2
mkdir -p /var/log/pm2

pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash
echo "PM2 configured — media-service is running"

# -------------------------------------------------------------------
# Nginx setup
# -------------------------------------------------------------------
echo ""
echo "=== Setting up Nginx ==="
apt install -y nginx

cp /var/www/media-service/deploy/nginx.conf /etc/nginx/sites-available/media-service
ln -sf /etc/nginx/sites-available/media-service /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx
systemctl enable nginx
echo "Nginx configured"

# -------------------------------------------------------------------
# Firewall
# -------------------------------------------------------------------
echo ""
echo "=== Configuring firewall ==="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "Firewall enabled (SSH + Nginx)"

# -------------------------------------------------------------------
# Done
# -------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Media Service deployment complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. DNS: media.amaterky.com → this Droplet's IP"
echo "  2. SSL: certbot --nginx -d media.amaterky.com"
echo "     (apt install -y certbot python3-certbot-nginx)"
echo "  3. Verify: curl http://localhost:3003/api/v1/health"
echo "  4. Logs: pm2 logs media-service"
echo ""
