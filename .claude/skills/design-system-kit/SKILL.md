# MSPIL Distillery ERP — Design System (Claude Skill)

> Internal design system reference for building inside or alongside the **Mahakaushal Sugar & Power Industries Ltd. (MSPIL) Distillery ERP**. Use when the user is working on ERP UI, ERP docs, slides about the ERP, or any customer / internal artefact that must match MSPIL's product look.

## When to invoke

Invoke when any of these apply:
- User mentions **MSPIL**, **Mahakaushal**, **Distillery ERP**, **ethanol ERP**, **grain unloading**, **fermenter F1-F4**, **weighbridge**, or any module name (inventory, GRN, PO, cash book, DDGS, etc.).
- User pastes a GitHub URL in `saifraza/ethanol_erp`.
- User asks for an ERP screen, admin console, factory dashboard *in the house style*.
- User wants print / letterhead / PDF artefacts on MSPIL paper.

## What's in here

| Path | Contents |
|---|---|
| `README.md` | Full brand + system doc: content, visual, iconography, file index |
| `colors_and_type.css` | CSS variables + semantic classes, drop-in for HTML prototypes |
| `assets/MSPIL_logo_transparent.png` | Corporate mark (gear ring + sugarcane + lightning) |
| `assets/MSPIL_logo.png` | Same logo on solid background |
| `assets/MSPIL_letterhead_hq.jpeg` | Printed letterhead for document templates |
| `preview/*.html` | 24 atom cards shown in Design System tab |
| `ui_kits/erp/Inventory Dashboard.html` | Canonical Tier 2 page |
| `ui_kits/erp/Purchase Orders.html` | Tier 2 list pattern with tabs + bulk actions |
| `ui_kits/erp/Login.html` | Sign-in (brand-forward) |
| `ui_kits/erp/Fermentation.html` | Tier 1 plant / process screen |
| `ui_kits/erp/index.html` | Kit index page |

## Hard rules — read before building

1. **Two tiers, never mix on one page.**
   - **Tier 2 (SAP / Enterprise)** — everything back-office. Rectangular, slate-800 toolbars, blue-600 actions, 10-11px UPPERCASE tracked labels, dense tables with vertical gridlines, `font-mono tabular-nums` on numbers, **no rounded corners**, **no shadows** except modals, **no emoji**.
   - **Tier 1 (Plant / Process)** — operator surfaces on phones. `border-radius: 6px`, colourful phase chips, 44px+ touch targets, 16px inputs (iOS anti-zoom), subtle shadows ok.
2. **Primary = blue-600 (`#2563eb`).** Never use semantic colours (emerald / red / amber) on action buttons — they are badge-only.
3. **Currency is Indian format, always mono-tabular:** `₹12,34,567`.
4. **Dates:** `dd-MMM-yyyy` (e.g. `24-Apr-2026`). Times in IST, 12-hour lowercase am/pm.
5. **No webfonts load.** System stack only. If substituting for a deck, use Inter + JetBrains Mono and flag it.
6. **Edge-to-edge in Tier 2.** Toolbars, filter bars, KPI strips, tables all bleed to the viewport with `-mx-3 md:-mx-6`.
7. **Never redraw the logo as SVG.** Always reference `assets/MSPIL_logo_transparent.png`.

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

See `ui_kits/erp/Inventory Dashboard.html` for the full pattern.

## Voice refresher
Direct, imperative, domain-specific, no marketing. "All items above reorder level." "3 invoices queued for e-Invoice retry." No exclamation points. No "please / sorry".

## Mobile (< 768px) — handled globally by design-kit.css

Tier 2 is desktop-first but must stay usable on phone. A `@media (max-width: 767px)` layer in `frontend/src/design-kit.css` cascades to every page automatically:

- KPI grids (`grid-cols-4/5/6/7/8`) collapse to 2 cols
- Toolbars (`sap-toolbar` / `bg-slate-800 flex`) wrap to 2 rows instead of truncating
- Tables: `-webkit-overflow-scrolling: touch`, min 44px row height
- Buttons / links / selects: min 44px touch target (except toolbar/table-inline buttons)
- Modals (`fixed inset-0 shadow-2xl`) go full-screen
- Main padding tightens to 0.5rem
- Safe-area insets respected on header + sticky-bottom action bars

**Per-page responsibilities**:
1. Always wrap tables in `<div class="overflow-x-auto">`
2. Use `md:` breakpoint when desktop needs different layout (`grid-cols-1 md:grid-cols-4`)
3. Never hard-set `style={{minWidth}}` on toolbars — breaks the mobile wrap
4. Test at 375px before shipping (`preview_resize preset: mobile`)

Escape hatches: `.mobile-stack` / `.mobile-hide` / `.mobile-only` / `.hide-mobile`.
