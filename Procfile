# Schema migrations are handled at startup by `runSchemaDriftGuard()` in
# backend/src/services/schemaDriftGuard.ts — NOT by `prisma db push`. Three
# separate Railway deploys (2026-04-21, 2026-05-02, 2026-05-04) showed that
# `prisma db push --skip-generate` silently skips changes in this environment,
# so the team committed to SchemaDriftGuard as the only schema mechanism.
# Don't add `prisma db push` back here — register new columns/tables in
# EXPECTED_COLUMNS / EXPECTED_TABLES instead.
web: sh -c "cd backend && node dist/server.js"
