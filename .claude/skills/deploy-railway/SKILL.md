---
name: deploy-railway
description: Explains how the MSPIL cloud ERP deploys on Railway from a root Dockerfile, why Railpack/Nixpacks were abandoned (Chromium libs for puppeteer PDF render), the build chain npm ci triggers, and the debug ladder when a deploy fails. Use before editing the root Dockerfile, Procfile, nixpacks.toml, or any Railway builder/start-command config, or when diagnosing build failures, container-exit, puppeteer/Chromium 500s, or schema-rejected-at-boot.
when_to_use: Triggers on Dockerfile, Procfile, Railway build, Railway deploy, deploy failure, image push stall, build chain, Railpack, Nixpacks, nixpacks.toml, puppeteer, Chromium, PDF render 500, "the cloud is broken", or start-command changes for the cloud production service.
---

# Deploy — Railway (root Dockerfile, NOT Railpack/Nixpacks)

Read this before touching the root `Dockerfile`, `nixpacks.toml`, `Procfile`, or any Railway builder / start-command config. The cloud production deploy (https://app.mspil.in/) is downstream — a bad push goes straight to prod. Auto-deploys from GitHub `main`.

Related memory: `feedback_npm_prune_breaks_prisma.md`, `feedback_puppeteer_needs_dockerfile.md`, `feedback_railway_service_wedge.md`, `project_2026_05_07_railway_migration.md`.

## Hard rules — NEVER / ALWAYS

- **NEVER add `npm prune --omit=dev`** to the build — it deletes the generated `@prisma/opc-client` (not in package.json), breaking the OPC routes. (PR #71 reverted it; don't add it back.)
- **NEVER switch the builder back to Railpack** without first confirming `nixpacks.toml` lists every library puppeteer needs **and** that Railpack actually reads it (it does NOT, as of 2026-05-08).
- **NEVER run `prisma db push` in the Dockerfile or start command.** Schema changes are owned by `schemaDriftGuard.ts` at server boot. Adding `db push` back silently regresses schema work (incidents 2026-04-21, 2026-05-02, 2026-05-04).
- **NEVER bake secrets into the Dockerfile.** Railway injects env vars at runtime.
- **NEVER change the start command** without verifying the Procfile/CMD wrap matches the new builder. A bare `cd backend && node dist/server.js` fails on Railpack-native shells (needs `sh -c "..."`).
- **ALWAYS run `GET /api/admin/email-diagnostic` first** when "the cloud is broken" — it isolates SMTP / DB / Chromium / network in one call.

## Current state

- Production Railway service `web` builds from the **root `Dockerfile`** (since 2026-05-08, PR #80).
- `nixpacks.toml` still exists as a reference for the apt package list, but Railway ignores it when a Dockerfile is present.
- `Procfile` still exists: `web: sh -c "cd backend && node dist/server.js"` — used as the start command when Railpack is the builder; harmless when Docker is.
- Custom Start Command on the Railway service is **empty** — the Dockerfile `CMD` runs.

## Why Dockerfile (the lesson)

After the 2026-05-07 Railway project migration, the new project's `web` service defaulted to the **Railpack** builder. Railpack ignores `nixpacks.toml`, so the ~25 apt packages Chromium needs (`libnss3`, `libatk1.0-0`, `libcups2`, `libgbm1`, `libpango-1.0-0`, `fonts-noto`, …) were absent from the image.

Symptom: every endpoint calling `puppeteer.launch()` returned 500 — RFQ pdf, work-order pdf, send-email (renders the attachment first), invoice pdf preview. SMTP and DB worked fine; only PDF render broke. Diagnosis:

1. `GET /api/admin/email-diagnostic` → `verify.ok=true`, `send.ok=true` → SMTP fine.
2. Extended diagnostic with PDF render → `pdf.ok=false`, error `Failed to launch the browser process` → Chromium libs missing.
3. Fix options: switch builder back to Nixpacks in the dashboard, OR ship a Dockerfile and let it auto-pick.

Chose Dockerfile (PR #80) because it's version-controlled — the next migration can't regress it, and the libs list lives in the repo, not in Railway settings.

## What the Dockerfile does

```dockerfile
FROM node:20-slim

# Chromium / puppeteer runtime libs — keep in sync with nixpacks.toml apt list
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libxshmfence1 libxfixes3 libxext6 libx11-6 libx11-xcb1 \
    libxcb1 libxcursor1 libxi6 libxtst6 libglib2.0-0 libdbus-1-3 \
    fonts-noto fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=4096"
COPY . .
RUN npm ci    # → triggers root postinstall → backend tsc + frontend vite + prisma generate
EXPOSE 3000
CMD ["sh", "-c", "cd backend && node dist/server.js"]
```

## The build chain (what `npm ci` triggers)

Root `package.json` has `"postinstall": "npm run build"`. The `build` script:

1. `cd backend && npm ci` — backend deps
2. `npx prisma generate` — main schema → `@prisma/client`
3. `npx prisma generate --schema=prisma/opc/schema.prisma` — OPC schema → `@prisma/opc-client`
4. `npx tsc --outDir dist`
5. `cp -r src/data dist/ && cp -r src/templates dist/` (HBS templates)
6. `cd ../frontend && npm ci`
7. `npx vite build --outDir ../backend/public --emptyOutDir` (frontend outputs to `../backend/public`, not `frontend/dist/`)
8. `rm -rf frontend/node_modules` (slim the image)

New static data files must be copied in this ROOT build script (step 5 pattern).

## When a deploy fails — debug ladder

1. **Image push stalls at the same MB across multiple deploys** → service is wedged Railway-side. Don't iterate on the build. Spin up a test service with the same code; if it succeeds, recreate the wedged service. (Incident 2026-05-07.)
2. **Build succeeds but container exits at "Create container"** → start command isn't a shell. Railpack's Procfile needs the `sh -c "..."` wrap (commit fab5ec2). Our Dockerfile CMD already wraps it.
3. **Container starts but PDF endpoints 500** → Chromium libs missing/stripped. Check `/api/admin/email-diagnostic` `pdf` block. Add the library to the Dockerfile, redeploy.
4. **Schema rejected at boot** (`P2022` / `P2021`) → SchemaDriftGuard didn't pick up a new column. The expected column is missing from `EXPECTED_COLUMNS` in `backend/src/services/schemaDriftGuard.ts`. Add it as `ADD COLUMN IF NOT EXISTS` and redeploy. (See CLAUDE.md "Schema changes" — every schema change needs BOTH the prisma schema edit and the guard registration.)
5. **OPC endpoints 500 with `Cannot find module '@prisma/opc-client'`** → the prune-dev hotfix regressed. Don't add it back.

## Diagnostic endpoint

`GET /api/admin/email-diagnostic` (SUPER_ADMIN/ADMIN) returns `{ env, verify, send, pdf }`. Run this first when "the cloud is broken" — it isolates SMTP / DB / Chromium / network in one call. Browser console snippet (logged in as admin):

```js
fetch('/api/admin/email-diagnostic', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })
  .then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2)));
```
