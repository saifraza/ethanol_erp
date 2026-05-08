# Telegram Bot — Architecture Guide

Quick map for adding new features to the in-process Telegram bot.

## Why Telegram?

Plant operators submit data and run admin actions via Telegram instead of the
web UI. Reasons:
- Phone-friendly (operators don't carry laptops to the gate)
- Survives spotty WiFi (long-poll auto-retries)
- Minimal training (everyone knows how to send a chat message)
- Faster than the web form for short flows (~60s vs ~3 min for adding labor)

## Files

| File | Purpose |
|---|---|
| `telegramBot.ts` | Long-polling client + handler-chain registry. **Don't touch unless changing the bot's transport layer.** |
| `telegramClient.ts` | Outgoing message helpers — `tgSend(chatId, msg, module)`, `tgSendGroup(...)`. Use these in your feature module. |
| `telegramAutoCollect.ts` | Generic engine for **periodic numeric readings**. Drives the modules in `autoCollectModules/`. |
| `autoCollectModules/` | One file per scheduled reading flow (decanter, ddgsProduction, …). Pattern: STEPS / parseReply / saveData. |
| `telegramAiChat.ts` | Free-form Q&A handler. Last in the chain — catches anything no module claimed. |
| `telegramImageHandler.ts` | Photo intake (e.g., reading meter snapshots). |
| `telegramLabor.ts` | **Conversational labor flow** — branching state machine, DB lookups, mixed text fields. Reference template for similar features. |

## Handler chain

`telegramBot.ts` exposes:
```ts
type IncomingHandler = (chatId: string, text: string, name: string | null) => Promise<boolean>;
registerIncomingHandler(handler);
```

Every incoming text message is offered to each handler in order. The first
handler that returns `true` consumes the message; the chain stops.
A handler that returns `false` means "not for me, try the next one."

Initialization order in `server.ts`:
```ts
initTelegram().then(() => {
  initTelegramAutoCollect();   // session-scoped numeric collection
  initTelegramLabor();          // conversational labor flow
  initImageHandler();           // photo intake
  initTelegramAiChat();         // catch-all AI fallback (must register LAST)
});
```

**Order matters.** AI chat is last because it would otherwise eat keywords
that should trigger specific feature flows. Add new feature handlers
**before** `initTelegramAiChat`.

## Two patterns

### Pattern A — Auto-collect (periodic numeric readings)

Use when:
- The data is a fixed grid of numbers (decanter D1/D2/D3 × Feed/WetCake/ThinSlopGr)
- You want the bot to **prompt operators on a schedule** (every 30 min, etc.)
- All inputs parse as floats

How to add:
1. Copy `autoCollectModules/_template.ts` → `myModule.ts`
2. Define `STEPS` (rows × columns), implement `buildPrompt`, `parseReply`,
   `buildConfirmation`, `buildSummary`, `buildErrorHint`, `saveData`
3. Register in `autoCollectModules/index.ts`:
   ```ts
   export const MODULE_REGISTRY: Record<string, ModuleConfig> = {
     decanter: decanterConfig,
     ddgs: ddgsConfig,
     myModule: myModuleConfig,   // ← add
   };
   ```
4. Configure schedule via the ERP admin UI (Settings > Auto-Collect Schedules)

### Pattern B — Conversational flow (operator-initiated, branching)

Use when:
- Operator triggers it (typing a keyword like `labor`, `wo`, `payment`)
- Has menus / branching / DB lookups / mixed text fields
- Doesn't fit a neat numeric grid

How to add (use `telegramLabor.ts` as the reference template):
1. Create `telegramFOO.ts`
2. Define your session shape: `{ chatId, mode, step, draft, expiresAt }`
3. Maintain `const sessions = new Map<string, FooSession>();` (in-memory; OK
   to lose on restart since flows are short-lived)
4. Implement the handler:
   ```ts
   async function handleFooMessage(chatId, text, name): Promise<boolean> {
     const session = sessions.get(chatId);
     // 1. If no session and text is your trigger keyword → start session, return true
     // 2. If session exists and expired → cleanup, return true
     // 3. Universal cancel keywords → cleanup, return true
     // 4. Dispatch on session.step → return true
     // 5. Otherwise return false (let next handler try)
   }
   ```
5. Export `initTelegramFoo()` that calls `registerIncomingHandler(handleFooMessage)`
6. Wire in `server.ts` **before** `initTelegramAiChat`

Trigger keyword conventions:
- Use a single word, lowercase (e.g., `labor`, `wo`, `payment`)
- Also accept a slash variant (`/labor`) — no extra cost
- Make `cancel` / `menu` / `/cancel` work universally inside the session

## Session lifecycle (Pattern B)

```
trigger keyword
   ↓
new session, mode='menu'
   ↓
operator picks → mode='add' (or 'list', 'edit', etc.)
   ↓
step-by-step prompts → step='pick_X', then 'pick_Y', ...
   ↓
final 'confirm_save' → DB write → cleanup session
```

Always include:
- 30-min auto-expiry sweep
- Universal cancel: `cancel`, `menu`, `/cancel`, `/menu`
- Re-typing the trigger keyword inside a session = restart from menu
- Try/catch around every step handler — a thrown error sends the operator a
  friendly message, not a crash

## Outgoing messages

`tgSend(chatId, message, module)` — `module` is a tag for the audit log only.
It does NOT route to specific handlers; it's just for filtering in the
TelegramMessage table.

Markdown is supported: `*bold*`, `_italic_`, `` `code` ``. Don't use HTML
formatting — the bot's parse mode is set to Markdown.

## Persistence

Every send/receive is logged to `prisma.telegramMessage` (table:
TelegramMessage). Useful for audit + debugging. Sessions themselves are
in-memory only — lost on restart, but that's fine because flows are short.

## Adding a new feature — checklist

- [ ] Pick pattern A or B based on the data shape
- [ ] If B: pick a unique trigger keyword that doesn't conflict with
      auto-collect modules or AI chat triggers (test first)
- [ ] Build the module with try/catch around every step
- [ ] Wire `init...()` in `server.ts` BEFORE `initTelegramAiChat()`
- [ ] Add the trigger to this doc's "Triggers" section below
- [ ] Smoke-test in the dev bot before pushing

## Triggers in use

| Keyword | Handler | Pattern | Purpose |
|---|---|---|---|
| `decanter` | autoCollect | A | Decanter readings (D1/D2/D3 × 3 fields) |
| `ddgs` | autoCollect | A | DDGS production bag count + weight |
| `labor` / `labour` / `/labor` | telegramLabor | B | Add labor worker / list running WOs |
| `(anything else)` | telegramAiChat | (catch-all) | Free-form Q&A |

Add new entries here when you ship new flows.
