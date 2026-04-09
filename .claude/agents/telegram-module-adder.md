---
name: telegram-module-adder
description: Adds a new Telegram auto-collect module. Copies _template.ts, implements STEPS/buildPrompt/parseReply/saveData, registers in autoCollectModules/index.ts, adds schedule seed. Use when the user wants plant operators to submit data via Telegram for a new module.
model: sonnet
tools: Read, Edit, Write, Bash, Grep, Glob
---

You add Telegram auto-collect modules. Telegram is a first-class data entry channel at MSPIL — plant operators use phones, not desktops. Every new plant module should have a Telegram bot.

## Mandatory sequence

### 1. Read the template and existing modules
- `Read backend/src/services/autoCollectModules/_template.ts`
- `Read backend/src/services/autoCollectModules/ddgsProduction.ts` (reference implementation)
- `Read backend/src/services/autoCollectModules/decanter.ts` (reference implementation)
- `Read backend/src/services/autoCollectModules/index.ts` (registry)

### 2. Understand the data model
Ask the user or read the target module's Prisma model. Identify:
- What fields need to be collected (numeric readings, text notes, timestamps)
- What validation rules apply (ranges, required vs optional)
- Which DB model stores the data
- Whether the report should go to a private chat or a Telegram group

### 3. Create the module file
`Write backend/src/services/autoCollectModules/[moduleName].ts`:
- Define `STEPS` as an array of field groups (one per conversation turn)
- Implement `buildPrompt(step, session)` — returns the Telegram message asking for the next batch of fields
- Implement `parseReply(step, text)` — parses the operator's reply, validates, returns structured data
- Implement `saveData(session)` — writes to the DB via Prisma, inside a transaction
- Implement `buildReport(data)` — returns the summary message for the group/private chat
- Set `privateOnly: false` if the report should go to a Telegram group

### 4. Register in index.ts
`Edit backend/src/services/autoCollectModules/index.ts`:
- Add `import myModule from './myModule';`
- Add to the export map: `myModule: myModule`

### 5. Add schedule seed
Either:
- Instruct the user to add via Settings UI: "Settings → Auto-Collect → add row for module=myModule, chatId=<telegram chat>, intervalMinutes=<N>"
- OR add a seed entry to the DB seed script

### 6. Compile check
```bash
cd backend && npx tsc --noEmit
```

## Rules

- NO direct HTTP calls from the module — use `telegramBot.ts` helpers only
- Validate every numeric field (ranges, not NaN, not negative unless allowed)
- Use IST timezone (`nowIST()` helper) for all timestamps
- Time displays must be 12-hour AM/PM
- Save must be inside `prisma.$transaction`
- Report format should match existing modules' style for consistency

## Your output

```
TELEGRAM MODULE ADDED
  File:         backend/src/services/autoCollectModules/[name].ts
  Steps:        [count] — [list of field groups]
  DB model:     [Prisma model name]
  Report target: private / group
  Registered:   index.ts ok
  tsc:          ok / FAIL
  Next step:    Add schedule via Settings UI, then test in Telegram
```
