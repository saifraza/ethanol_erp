# ADR 001: Weighbridge Dual-Mode (MSPIL Serial vs Oracle File)

**Status**: Accepted (2026-03)
**Decision**: The weighbridge PC runs two systems side by side — our MSPIL Flask app and the legacy Oracle/WtService. Desktop PowerShell scripts switch between modes.

## Context
- The factory has a legacy Oracle XE ERP that uses WtService (.NET) to read the weighbridge scale via COM1
- We needed our own system to read weight but couldn't remove Oracle — it runs the factory's other ERP functions
- COM1 can only be held by one process at a time

## Decision
- **MSPIL mode** (`switch-to-mspil.ps1`): Stops WtService, our Flask reads COM1 directly (live serial weight)
- **Oracle mode** (`switch-to-oracle.ps1`): Gives COM1 back to WtService, our Flask runs in file mode (reads weight file WtService writes)
- Both modes coexist — operator switches via desktop shortcut

## Why NOT Alternatives
- **Replace Oracle entirely**: Too risky — Oracle runs other factory functions we don't own
- **Virtual COM port splitter**: Tried — unreliable on Windows Server, dropped serial data
- **Read Oracle's file only**: No live weight display for our UI — operators need real-time feedback

## Consequences
- Must NEVER stop WtService without switching to MSPIL mode first
- `.env` on weighbridge PC must have `SERIAL_PROTOCOL=file` or `SERIAL_PROTOCOL=serial` matching current mode
- Trailing spaces in `.env` break API key auth (timingSafeEqual length mismatch) — always trim
