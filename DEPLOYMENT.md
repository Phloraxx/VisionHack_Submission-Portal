# Deployment

## Prerequisites

- **Node.js** >= 22 (tested with Node 22+)
- **npm** (ships with Node)
- **PocketBase** instance — either self-hosted or a managed service. See [PocketBase Schema](#pocketbase-schema) for setup.
- **Resend** API key (optional, for email notifications)

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your local values (PocketBase URL, admin credentials, etc.)

# 3. Start the dev server with hot reload
npm run dev
```

The dev server starts at `http://localhost:5173` by default (Vite dev server).

To apply the PocketBase schema (idempotent):

```bash
npm run setup:pb
```

## Production

### Build

Build the client and server bundles into the `build/` directory:

```bash
npm run build
```

Output:

| Path | Contents |
|---|---|
| `build/client/` | Static assets (HTML, JS, CSS, images) |
| `build/server/` | Server-side render bundle (`index.js`) |

### Start

Set `NODE_ENV=production` and launch the Node.js server:

```bash
NODE_ENV=production node server.ts
```

Or use the convenience script:

```bash
npm run start:prod
```

The server reads configuration from the environment (or a `.env` file via `dotenv`).
It listens on the port specified by `PORT` (default: `3000`).

**Example — bind to a specific port:**

```bash
PORT=8080 NODE_ENV=production node server.ts
```

## Environment Variables

All environment variables are documented in `.env.example`. Copy it to `.env` and fill in your values.

Key variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP listen port |
| `POCKETBASE_URL` | **Yes** | — | URL of the PocketBase instance |
| `POCKETBASE_SUPER_TOKEN` | **Yes** | — | Superuser admin token for schema migrations |
| `POCKETBASE_ADMIN_EMAIL` | **Yes** | — | Admin email used during setup |
| `POCKETBASE_ADMIN_PASSWORD` | **Yes** | — | Admin password used during setup |
| `ALLOWED_ORIGINS` | No | — | Comma-separated list of allowed CORS origins |
| `APP_URL` | No | — | Public-facing application URL |
| `RESEND_API_KEY` | No | — | Resend API key for transactional emails |

**Never commit secrets (`POCKETBASE_SUPER_TOKEN`, `RESEND_API_KEY`, etc.) to version control.**

## PocketBase Schema

The schema is managed programmatically and applied via an idempotent setup script:

```bash
npm run setup:pb
```

This script (`scripts/setup-pb.ts`) connects to the PocketBase instance configured in `.env` and creates or updates collections, fields, indexes, and admin accounts as needed. It is safe to run multiple times — only missing resources are created.

**Important:** Run this after every deployment that introduces schema changes.

## Rollback

To roll back a deployed version:

```bash
# 1. Checkout the previous known-good commit
git checkout <previous-stable-tag-or-commit>

# 2. Reinstall dependencies (if lockfile changed)
npm ci

# 3. Rebuild
npm run build

# 4. Restart the process
# If using PM2:
pm2 restart submission-portal

# If running directly:
# Stop the running process (Ctrl+C or kill), then:
NODE_ENV=production node server.ts
```

**Database rollback:** If the deployment introduced destructive schema changes, restore the PocketBase data from a backup *before* restarting the app against the old code. PocketBase provides a built-in backup feature (Admin UI > Settings > Backups or the `./pocketbase backup` CLI).

## Process Management (PM2)

Install PM2 globally:

```bash
npm install -g pm2
```

Start the application:

```bash
NODE_ENV=production pm2 start server.ts --name submission-portal -- --env-file .env
```

Other useful PM2 commands:

```bash
pm2 status                    # List all processes
pm2 logs submission-portal    # Tail logs
pm2 restart submission-portal # Restart
pm2 stop submission-portal    # Stop
pm2 delete submission-portal  # Remove from PM2
```

To persist the PM2 process list across reboots:

```bash
pm2 startup
pm2 save
```

## Reverse Proxy (nginx)

Below is a minimal nginx configuration that proxies requests to the Node.js server. Place it in `/etc/nginx/sites-available/submission-portal` and symlink to `/etc/nginx/sites-enabled/`.

```nginx
upstream submission_portal {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name visionhack.mulearn.org;

    # Redirect HTTP to HTTPS (recommended)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name visionhack.mulearn.org;

    # SSL certificates — adjust paths to your setup
    ssl_certificate     /etc/letsencrypt/live/visionhack.mulearn.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/visionhack.mulearn.org/privkey.pem;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Proxy pass to Node.js
    location / {
        proxy_pass http://submission_portal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;
    }

    # Serve static assets directly (bypass Node for performance)
    location /assets/ {
        alias /path/to/deployment/build/client/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Deny access to internal paths
    location ~ /\. {
        deny all;
    }
}
```

After making changes:

```bash
# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
# or: sudo nginx -s reload
```
