# Session State — Last Updated 2026-03-25

## Recent Changes (uncommitted in sandbox, need git push from Mac)
These changes are in the working directory but need `rm -f .git/HEAD.lock && git add -A && git commit && git push`:

1. **Dashboard DDGS unit fix** — `ddgsFromStock` and `ddgsFromProd` multiplied by 1000 (Tons→kg) so frontend `/1000` displays correctly
2. **Dashboard grain/ethanol stock fallback** — if no entries in date range, falls back to most recent entry (prevents showing 0 for silo stock)
3. **Fermentation readings list** — now shows RS, RST, DS, VFA badges (was only showing Level, SG, pH, Temp, Alc)
4. **DDGS report time** — report header uses IST `nowIST()` instead of `toLocaleTimeString()` (was showing UTC)
5. **Decanter entryTime** — same IST fix for auto-collect saved time
6. **BW report header** — removed misleading "(EMPTY)" status, just shows "*Beerwell = 01*"
7. **DDGS time window** — shows PREVIOUS hour (8PM-9PM at 9:26PM) not current hour
8. **DDGS privateOnly** — set to `false`, reports go to group + private
9. **DDGS summary** — includes "Saved at: HH:MM (Server IST)" line

## Already Pushed (deployed on Railway)
- Commit `28b09e6`: DDGS time window, group sharing, server IST, BW header
- Commit `35a8a1b`: IST timezone for all backend times
- Commit `1ebdfa7`: BW share fix, multi-number phones, DDGS private-only, IST timezone
- Commit `1eb4a57`: setupGravity source, DDGS Hindi bot, fermentation timestamps

## Known Issues
- `backend/src/routes/dashboard.ts` has ~182 pre-existing TS errors (implicit `any` types) — not blocking deployment
- Sandbox can't `git push` or remove `.git/HEAD.lock` — user must push from Mac
- WhatsApp connection has intermittent "stream errored out" reconnections on Railway (self-heals)

## Next Planned Work
1. **Accounts module** — full double-entry bookkeeping (see `accounts-full-module.md`)
2. **Utilities module** — steam, power, water tracking
3. **Maintenance module** — equipment, PM schedules, breakdowns
4. **Excise/Regulatory** — DPR, permits, form registers
5. **Production costing** — per-batch cost calculation

## User Preferences
- Saif (saifraza9@gmail.com) — technically smart, prefers concise answers
- Hindi prompts for DDGS bot (default), English toggle available
- IST timezone (UTC+5:30) for all time displays
- Railway auto-deploys from GitHub main branch
- User must run `rm -f .git/HEAD.lock` before git operations on Mac
