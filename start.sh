#!/bin/sh
cd backend
echo "[start.sh] Running prisma db push with --accept-data-loss..."
npx prisma db push --skip-generate --accept-data-loss
npx prisma db push --skip-generate --accept-data-loss --schema=prisma/opc/schema.prisma
echo "[start.sh] Starting server..."
node dist/server.js
