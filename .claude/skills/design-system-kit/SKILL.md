---
name: design-system-kit
description: MSPIL Distillery ERP design system — the house look for every ERP UI, screen, dashboard, login, letterhead, PDF, chart, and design-token decision. USE WHENEVER building or reviewing UI inside or alongside the ethanol/MSPIL ERP, when a screen must match the product style, or when the user mentions MSPIL, Mahakaushal, Distillery ERP, ethanol ERP, SAP Tier 2 / Tier 1, design tokens, letterhead, PDF artefacts, Recharts charts, or any module (inventory, GRN, PO, fermentation, weighbridge, accounts, etc.). The authoritative source for the two-tier UI vocabulary, colours, type, voice, iconography, SAP tokens, and chart rules.
when_to_use: User is working on ERP UI, an admin console, a factory/plant dashboard, a login screen, a print/letterhead/PDF artefact, or a Recharts chart that must match MSPIL's look; pastes a GitHub URL in saifraza/ethanol_erp; asks "what colour / font / token / chart style does the ERP use"; or names any ERP module or domain term (fermenter F1-F4, grain unloading, DDGS, cash book, e-Invoice, etc.).
---

# MSPIL Distillery ERP — Design System

Internal design system for building inside or alongside the **Mahakaushal Sugar & Power Industries Ltd. (MSPIL) Distillery ERP** (`saifraza/ethanol_erp`, prod `https://app.mspil.in/`). Use for any ERP UI, doc, slide, or customer/internal artefact that must match the product look.

This SKILL.md is the lean overview. The deep material lives in bundled files — **point to them, don't restate them.**

## Where things live (point, don't fork)

| Need | Open |
|---|---|
| Full brand + system doc (content, visual, iconography, file index, voice) | `README.md` |
| Authoritative **Tier 2 (SAP) design tokens** — exact Tailwind classes per element | `reference/sap-tier2-tokens.md` |
| **Recharts** chart design system — container, axes, tooltip, palette, line/bar/area, brush, etc. | `reference/charts-recharts.md` |
| Drop-in CSS variables + semantic classes for HTML prototypes | `colors_and_type.css` |
| Canonical Tier 2 page (toolbar + KPI strip + tables) | `ui_kits/erp/Inventory Dashboard.html` |
| Tier 2 list pattern (tabs + bulk actions) | `ui_kits/erp/Purchase Orders.html` |
| Brand-forward sign-in | `ui_kits/erp/Login.html` |
| Tier 1 plant / process screen | `ui_kits/erp/Fermentation.html` |
| Kit index | `ui_kits/erp/index.html` |
| 24 atom cards (Design System tab) | `preview/*.html` |
| Logo / letterhead | `assets/MSPIL_logo_transparent.png`, `assets/MSPIL_logo.png`, `assets/MSPIL_letterhead_hq.jpeg` |

Deep detail lives in `reference/sap-tier2-tokens.md` (the authoritative SAP Tier 2 Tailwind tokens) and `reference/charts-recharts.md` (the Recharts chart system) — load those on demand; this SKILL.md stays lean.

## Hard rules — read before building

1. **Two tiers, never mix on one page.**
   - **Tier 2 (SAP / Enterprise)** — everything back-office. Rectangular, `slate-800` toolbars, `blue-600` actions, 10–11px UPPERCASE tracked labels, dense tables with vertical gridlines, `font-mono tabular-nums` on numbers, **no rounded corners**, **no shadows** except modals, **no emoji**. When in doubt, use Tier 2.
   - **Tier 1 (Plant / Process)** — operator surfaces on phones. `border-radius: 6px`, colourful phase chips, 44px+ touch targets, 16px inputs (iOS anti-zoom), subtle shadows ok.
2. **Primary = blue-600 (`#2563eb`).** Never use semantic colours (emerald / red / amber) on action buttons — they are badge-only.
3. **Currency is Indian format, always mono-tabular:** `₹12,34,567` via `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
4. **Dates:** `dd-MMM-yyyy` (e.g. `24-Apr-2026`). Times in IST, 12-hour lowercase am/pm (`2:45 pm`). ISO for machine fields.
5. **No webfonts load.** System stack only. If substituting for a deck, use Inter + JetBrains Mono and flag it.
6. **Edge-to-edge in Tier 2.** Toolbars, filter bars, KPI strips, tables all bleed to the viewport with `-mx-3 md:-mx-6`.
7. **Never redraw the logo as SVG.** Always reference `assets/MSPIL_logo_transparent.png`.
8. **Charts = Recharts only.** Never Chart.js, D3, or any other library. See `reference/charts-recharts.md`.

## Quick recipe — Tier 2 page scaffold

```html
<link rel="stylesheet" href="../colors_and_type.css">
<div class="wrap">
  <div class="sap-toolbar"><span class="t-page-title">Module Title</span> <button class="sap-btn-primary">+ New</button></div>
  <!-- filter bar -->
  <!-- KPI strip: 4×.sap-kpi with border-l-4 accent -->
  <!-- table: slate-800 header, vertical gridlines, striped rows -->
</div>
```

See `ui_kits/erp/Inventory Dashboard.html` for the full pattern, and `reference/sap-tier2-tokens.md` for the exact class string per element.

## Voice refresher
Direct, imperative, domain-specific, no marketing. "All items above reorder level." "3 invoices queued for e-Invoice retry." No exclamation points. No "please / sorry". Domain-first vocabulary (fermenter, GRN, PO, weighment, dip, DDGS, CIP). Full content rules — casing, numbers, forbidden copy — are in `README.md`.

## Mobile (< 768px) — handled globally by `frontend/src/design-kit.css`

Tier 2 is desktop-first but stays usable on phone. A `@media (max-width: 767px)` layer in `frontend/src/design-kit.css` cascades to every page automatically:

- KPI grids (`grid-cols-4/5/6/7/8`) collapse to 2 cols
- Toolbars (`sap-toolbar` / `bg-slate-800 flex`) wrap to 2 rows instead of truncating
- Tables: `-webkit-overflow-scrolling: touch`, min 44px row height
- Buttons / links / selects: min 44px touch target (except toolbar/table-inline buttons)
- Modals (`fixed inset-0 shadow-2xl`) go full-screen
- Main padding tightens to 0.5rem
- Safe-area insets respected on header + sticky-bottom action bars

**Per-page responsibilities**:
1. Always wrap tables in `<div class="overflow-x-auto">`
2. Use `md:` breakpoint when desktop needs a different layout (`grid-cols-1 md:grid-cols-4`)
3. Never hard-set `style={{minWidth}}` on toolbars — breaks the mobile wrap
4. Test at 375px before shipping (`preview_resize preset: mobile`)

Escape hatches: `.mobile-stack` / `.mobile-hide` / `.mobile-only` / `.hide-mobile`.
