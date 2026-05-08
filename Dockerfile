# Cloud ERP — Docker build for Railway deploy.
#
# Why a Dockerfile when nixpacks.toml exists?
#   The 2026-05-07 migration to a fresh Railway project landed on the
#   Railpack builder, which ignores nixpacks.toml. That left the image
#   without the Chromium system libraries puppeteer needs, so any PDF
#   render (RFQ, PO, work order email attachments) 500'd in prod with
#   "Failed to launch the browser process". This Dockerfile reproduces
#   the apt-get list from nixpacks.toml verbatim and keeps it under
#   version control so the next migration can't regress it.
#
# Build chain: same as before — root `npm ci` triggers the postinstall
# hook in package.json, which runs backend tsc + prisma generate
# (cloud + opc) + frontend vite build into backend/public.

FROM node:20-slim

# Chromium / puppeteer runtime libs — keep this list in sync with
# nixpacks.toml's [phases.setup].aptPkgs entry.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libxfixes3 \
    libxext6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    libglib2.0-0 \
    libdbus-1-3 \
    fonts-noto \
    fonts-noto-cjk \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Headroom for tsc + vite build combined (default Node heap is ~1.5 GB).
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Skip the puppeteer post-install Chromium download here so we keep cache hits;
# the backend `npm ci` further down will fetch it inside backend/node_modules.
ENV PUPPETEER_SKIP_DOWNLOAD=false

COPY . .

# Root npm ci runs postinstall which drives the full build:
#   backend npm ci → prisma generate (cloud + opc) → tsc → copy data + templates
#   frontend npm ci → vite build → frontend node_modules cleanup
RUN npm ci

EXPOSE 3000

CMD ["sh", "-c", "cd backend && node dist/server.js"]
