# ADR 003: Type-Specific Weighment Handlers

**Status**: Accepted (2026-04)
**Decision**: Each weighment type (PO inbound, trader, spot, ethanol outbound, DDGS outbound, etc.) has its own handler file with independent business logic.

## Context
- A single "weighbridge push" endpoint receives all weighment types from factory
- Each type has radically different downstream behavior:
  - PO inbound → auto-creates GRN, updates PO line quantities, syncs inventory
  - Trader inbound → creates/extends running monthly PO, auto-closes stale POs
  - Spot inbound → creates DirectPurchase record (no PO)
  - Ethanol outbound → updates DispatchTruck with race-condition-safe compare-and-set
  - DDGS outbound → contract-aware dispatch + auto-invoice + e-invoice (IRN/eWB)

## Decision
- `push.ts` is the dispatcher — routes to the right handler based on `direction` + `purchase_type` + `handler_key`
- `pre-phase.ts` handles partial states (GATE_ENTRY, FIRST_DONE) before dispatch
- Each handler in `handlers/` is independent — owns its transaction, error handling, and downstream effects
- `shared.ts` has common utilities (auth check, schema validation, duplicate detection)

## Why NOT Alternatives
- **One big handler with switch/case**: Tried this originally (the 1332-line god-route). Unmaintainable — every change risked breaking other types
- **Event-driven (pub/sub)**: Adds complexity for no benefit — we need synchronous confirmation that GRN was created

## Consequences
- Adding a new product type = new handler file + register in `push.ts` dispatcher
- Handlers must be idempotent (factory retries on sync failure)
- Each handler must use `$transaction` for atomic multi-table writes
- See `.claude/skills/weighbridge.md` Part B for the add-product contract
