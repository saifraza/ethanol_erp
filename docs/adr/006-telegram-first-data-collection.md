# ADR 006: Telegram-First Data Collection

**Status**: Accepted (2026-03)
**Decision**: Plant operators submit hourly readings via Telegram bots instead of logging into the web UI.

## Context
- Plant operators are on the factory floor — phones, not desktops
- Web UI requires login, navigation, form filling — too many steps for hourly readings
- Operators already use Telegram for group communication

## Decision
- Telegram Bot runs in-process on the ERP server (long-polling, no separate worker)
- Auto-collect bots: scheduled conversations that ask operators for readings, parse replies, save to DB
- Each module has its own bot file in `autoCollectModules/` with STEPS, buildPrompt, parseReply, saveData
- Schedules stored in `AutoCollectSchedule` DB table
- Reports auto-shared to configured Telegram groups after collection

## Why NOT Alternatives
- **WhatsApp Business API**: Expensive, rate-limited, requires business verification
- **Custom mobile app**: Development overhead, app store approval, operator training
- **Web UI only**: Operators won't use it consistently from the plant floor
- **SMS**: No rich formatting, no images (we use Gemini Vision OCR for photo readings)

## Consequences
- Every new process module should consider Telegram integration from day one
- Bot must handle: text input, photo input (OCR), "skip" responses, timeouts
- Module files follow strict template pattern — copy `_template.ts`
- `privateOnly: false` for reports that should go to group chats
