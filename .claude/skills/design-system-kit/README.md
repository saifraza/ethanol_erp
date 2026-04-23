# MSPIL Distillery ERP — Design System

A brand + UI reference for **Mahakaushal Sugar & Power Industries Ltd.** (MSPIL) — a 24/7 industrial ethanol, sugar, power and DDGS plant at Village Bachai, Narsinghpur, MP, running an internal ERP on React + Vite + Tailwind + Express + Prisma + PostgreSQL.

This isn't a consumer-facing brand. It is an **industrial ERP** for an operating distillery, with two very different user populations sharing one codebase. Keep that in mind when designing anything here.

---

## Context

- **Company:** Mahakaushal Sugar & Power Industries Ltd. (MSPIL)  
  *CIN U01543MP2005PLC017514, GSTIN 23AAECM3666P1Z1*  
  Regd off: SF-11, Second Floor, Aakriti Business Center, Aakriti Eco City, Bawadiya Kalan, Bhopal-462039  
  Plant: Village Bachai, Dist. Narsinghpur (M.P.) – 487001
- **Product surfaces:** A single web ERP at `https://app.mspil.in/` covering the entire factory + office: plant operations, procurement, sales, inventory, accounts, HR/payroll, compliance, tax, admin — plus a weighbridge PC Flask app, a factory-server Windows app, and a Telegram bot for operators.
- **Stack:** React + Vite + Tailwind (frontend), Express + TypeScript + Prisma (backend), PostgreSQL on Railway, Recharts for charts, Lucide for icons. System font stack only.

## Two design tiers

The ERP deliberately uses **two visual vocabularies**, documented in the repo's `.claude/skills/sap-design-tokens.md` and `DESIGN.md`:

| Tier | Audience | Style | Use for |
|---|---|---|---|
| **Tier 1 — Plant / Process** | Operators on phones, in a noisy 24/7 plant | Rounded corners, colourful phase chips, big 44px+ touch targets, emoji-friendly | Fermentation, grain unloading, dosing, Telegram-driven entries |
| **Tier 2 — SAP / Enterprise** | Office staff, accounts, admin on desktop | Dense, edge-to-edge, uppercase tracked labels, slate-800 toolbars, `border-r` gridlines, NO rounded corners, NO emojis, `font-mono tabular-nums` numbers | Everything else (accounts, inventory, sales, procurement, HR, admin, reports). All new modules. |

When in doubt: **use Tier 2**.

## Sources referenced

Everything here was reverse-engineered from these files in `saifraza/ethanol_erp@main`. Not assumed — read:

| File | What it gave us |
|---|---|
| `DESIGN.md` | Color palette, button classes, phase colors |
| `CLAUDE.md` | Architecture, two-tier UI rule, domain vocabulary |
| `SYSTEM.md` | Stack, plant params, project structure |
| `frontend/src/index.css` | Actual CSS variable values + `.card`, `.btn-*`, `.input-*` definitions |
| `frontend/tailwind.config.js` | Primary (blue) color scale |
| `frontend/src/components/Layout.tsx` | Sidebar, health banner, notification tray |
| `frontend/src/config/modules.ts` | Full module inventory & icon usage |
| `frontend/src/pages/inventory/StockDashboard.tsx` | Canonical Tier 2 page (toolbar + KPI strip + tables) |
| `frontend/src/pages/Login.tsx` | Login screen |
| `.claude/skills/sap-design-tokens.md` | Authoritative Tier 2 token reference |
| `assets/MSPIL_logo_transparent.png` | Brand logo |

None of the above are bundled into this design system; they live in the repo. The bits we need are lifted into `colors_and_type.css`, `assets/`, `ui_kits/`, and `preview/`.

---

## CONTENT FUNDAMENTALS

MSPIL is an industrial operations product; copy is **functional, terse, and domain-specific**. It is never marketing copy.

### Voice & tone
- **Direct, declarative, imperative.** Short sentences. No filler. "Run bulk updates inside `BEGIN; ... COMMIT;`."
- **Second-person instructions** ("you") for operators and admins; **third-person** for audit trails ("user X approved PO-1234 at 14:02 IST").
- **No marketing language.** Never "delight", "powerful", "seamless", "magical". Operators don't care.
- **Blunt safety language for destructive actions.** "Factory runs 24/7, no 'safe window' — treat every statement as if 50 trucks are at the gate." This attitude carries into UI error messages and confirmations.
- **Domain-first vocabulary.** Use the plant's words: *fermenter*, *PF vessel*, *wash*, *dosing*, *CIP*, *GRN*, *PO*, *weighment*, *dip*, *DDGS*, *ethanol-dispatch*. Do not soften them ("batch run" → no, "REACTION phase" → yes).

### Casing — this is specific
- **UPPERCASE tracked labels** are the system's signature. Use for page titles, KPI labels, table headers, section captions, tab names, toolbar titles, and all badge content. Always paired with `letter-spacing: widest` (0.1em) and a small size (10–11px).  
  Examples from the product: `INVENTORY DASHBOARD`, `TOTAL VALUE`, `CATEGORY`, `RECENT MOVEMENTS`, `LOW STOCK ALERTS`, `DISTILLERY ERP`, `FILLING`, `DRAFT`.
- **Title case** for sidebar nav labels ("Purchase Orders", "Chart of Accounts", "Grain Unloading"), buttons ("Refresh", "Mark all read", "Sign In"), and short headings in modals.
- **Sentence case** for body text, help text, toasts, and notification messages ("Server connection lost — reconnecting…", "No modules assigned. Contact admin.").
- **Abbreviations are fine, often preferred.** `PO`, `GRN`, `CIP`, `PDC`, `GST`, `TDS`, `TCS`, `DDGS`, `HSN`, `CoA`, `WB`, `RM`, `IST`. Operators know them; readers who don't are not the target user.

### Numbers, currency, dates
- **Currency** always uses `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` → `₹12,34,567`. Indian grouping, not Western. Always `font-mono tabular-nums`.
- **Dates** are `dd-MMM-yyyy` (`15-Apr-2026`) for display; ISO for machine fields.
- **Time** is IST, 12-hour with lowercase am/pm (`2:45 pm`). Server is UTC; frontend converts.
- **Units** stay beside numbers and are muted: `1,500 Ton`, `2,300 M³`, `31 %`.

### Examples (verbatim from the product)
- Sidebar header: `DISTILLERY ERP`
- Login subtitle: *"Mahakaushal Sugar & Power Industries Ltd."*
- Health banner: *"Server connection lost — reconnecting..."*
- Empty states: *"All items above reorder level"*, *"No notifications"*, *"No valuation data available"*
- KPI labels: `TOTAL ITEMS`, `TOTAL VALUE`, `LOW STOCK ALERTS`, `PENDING COUNTS`
- Sidebar group headers: `PLANT`, `SALES`, `PURCHASE`, `ACCOUNTS`, `BOOKS`, `INVENTORY`, `COMPLIANCE`, `TAX & STATUTORY`, `HR & PAYROLL`, `ADMIN`

### Forbidden
- Emoji in any Tier 2 surface. Tier 1 plant UI may use them sparingly.
- Exclamation points. Never. The product does not exclaim.
- "Please" / "Sorry" in error copy — just say what happened and what to do.
- Inventing new domain words. Use the existing ones in `.claude/skills/*.md`.

---

## VISUAL FOUNDATIONS

### Brand palette (logo)
- **MSPIL Green** `#8DC641` — the sugarcane ring. Use as a brand accent, never as an action colour.
- **MSPIL Navy** `#1E3A8A` — the "MAHAKAUSHAL SUGAR AND POWER INDUSTRIES LTD" wordmark around the logo. This happens to match `primary-900` — good.
- **Steel Grey** `#A7A9AC` — the gear-cog ring. Used sparingly as an industrial texture cue.

### Product palette
**Primary — Blue.** All action UI is blue. `#2563eb` (primary-600) for buttons, active nav, links; `#1d4ed8` (primary-700) hover; `#3b82f6` (primary-500) for charts and secondary accents.

**Neutrals — two scales on purpose.**  
- **Gray** (`gray-50…900`) for Tier 1 surfaces, the sidebar (`gray-900`), and body text.  
- **Slate** (`slate-50…900`) for Tier 2 surfaces — toolbars (`slate-800`), table headers, gridlines, input borders.

**Semantic — badges only.** Emerald `#059669` (success), red `#dc2626` (danger), amber `#f59e0b` (warning), plus a dedicated fermentation phase map (indigo / amber / green / emerald / cyan / blue / purple / gray). **These never appear on primary action buttons** — rule enforced in `DESIGN.md`.

See `preview/colors-primary.html`, `colors-neutrals.html`, `colors-semantic.html`, `colors-phase.html` for swatches; see `colors_and_type.css` for the variables.

### Typography
- **Font family:** system stack — `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No webfont is loaded. Numbers use `ui-monospace` for tabular alignment.
- **Scale (Tier 2):** 9px (badges), 10px (uppercase labels), 11px (small buttons), 12px (table body), 14px (body), 16px (inputs — iOS anti-zoom), 20px (KPI values), 24–32px (page titles, rare).
- **Tracking:** `0.1em` (widest) on all-caps labels, KPI captions, tab names, toolbar titles. Without it, the aesthetic collapses.
- **Weight:** 400 (body), 500 (buttons, sidebar links), 600–700 (headings, KPI values, table headers).

### Spacing & density
Tight. The ERP intentionally packs a lot on screen: `px-3 py-1.5` table cells, `py-2` toolbars, `space-y-0` between major sections. Pages are **edge-to-edge**: Tier 2 surfaces use `-mx-3 md:-mx-6` to cancel page padding and bleed to the viewport edge.

### Backgrounds & textures
- **Page:** flat `slate-50` (#f8fafc) Tier 2, `gray-50` (#f9fafb) Tier 1. Never gradients.
- **Cards:** flat white. No textures, no illustrations, no repeating patterns.
- **Sidebar:** flat `gray-900`, white text.
- **Toolbars & table headers:** flat `slate-800`, white text.
- **Row striping:** `even:bg-slate-50/70` in tables.
- **Hover state — global rule:** table rows get `bg-blue-200` + a `3px inset blue-600` left accent on hover. Every table in the product inherits this from `index.css`; don't override it.

### Borders, gridlines, corners
- **Borders are structural, not decorative.** `1px solid slate-300` on cards and KPI containers; `1px solid slate-100` between table cells; `1px solid slate-700` between header cells (on `slate-800` bg).
- **Vertical gridlines in every data table** (`border-r`). This is the SAP feel.
- **Corner radii are BANNED in Tier 2.** No `rounded`, `rounded-lg`, `rounded-xl`. Tier 1 uses `border-radius: 6px` on cards and buttons.
- KPI strips use a coloured **4-px left border** to encode meaning (`border-l-4 border-l-blue-500` / `emerald-500` / `amber-500` / `slate-500`).

### Shadows & elevation
Almost none. Cards are flat with a border. `shadow-2xl` is reserved for modals and the notification popover. No `shadow-sm`, no glows, no neumorphism. Z-axis is communicated with borders, not shadow.

### Transparency & blur
Used very sparingly: mobile sidebar backdrop is `bg-black/50`, even-row striping is `bg-slate-50/70`, hover rows are `bg-blue-50/40` in some tables. No `backdrop-blur` anywhere — the product is meant to be readable on a 2012-era factory Windows box.

### Animation
- **Sidebar slide-in:** `transform 200ms ease-in-out`.
- **Button/row/input colour:** `transition: background 0.15s`.
- **Row entry:** `animate-in` — 200ms ease-out slide-up by 8px with fade.
- **Connection spinner:** border-spin 1s linear on the reconnect dot.
- **That is it.** No bouncy springs, no parallax, no scroll-jacking, no page transitions.

### Hover & press states
- **Buttons:** hover darkens by one scale step (`blue-600 → blue-700`, `white → slate-50`). No shrink, no lift, no shadow.
- **Sidebar links:** inactive `text-gray-300 hover:bg-gray-800`; active `bg-blue-600 text-white`.
- **Table rows:** global blue-200 tint + blue-600 left accent bar (see above).
- **Cells/inputs:** focus uses `box-shadow: 0 0 0 1px slate-400` + border colour shift to slate-500.

### Imagery
The product has almost no marketing imagery — only **the logo, the letterhead scan, and generated document PDFs** (POs, GRNs, invoices). When imagery is needed it is warm and desaturated (the letterhead has an olive-green tint), never glossy or saturated.

### Iconography
Covered in the **ICONOGRAPHY** section below.

### Layout rules
- **Sidebar:** fixed 240–256px wide on desktop, slide-over on mobile.
- **Top bar:** only on mobile (`md:hidden`) — gray-900 with the hamburger and product name.
- **Main content:** `overflow-auto`, `bg-slate-50` (Tier 2) or `bg-gray-50` (Tier 1), `p-3 md:p-6`.
- **Health banner:** full-width `amber-500` strip pinned to top, z-50, when API is down.
- **Notification popover:** anchored bottom-left of the user block, `shadow-2xl`, left-border severity colour.
- **Forms are dense.** Labels above inputs, `text-[10px]` uppercase widest. Inputs `text-xs`, `px-2.5 py-1.5`, `border slate-300`, no rounded.

---

## ICONOGRAPHY

### System
**Lucide React** is the only icon library used. Stroke-based, 1.5px stroke, rounded caps. Imported by name per usage.

Typical sizes:
- `size={13}` — footer meta, inline chevrons
- `size={14}` — sidebar group chevrons
- `size={16}` — notification bell, small action icons
- `size={17}` — sidebar nav item icons
- `size={20}` — mobile hamburger, close buttons
- `w-3.5 h-3.5` — toolbar button glyphs (≈14px)

Icons inherit colour from text; they don't have their own colour. Active sidebar item icons become white on blue; everything else stays `text-gray-300 / slate-500`.

Frequently-used Lucide icons (from the real module config):
`LayoutDashboard, Wheat, CogIcon, Droplets, Beaker, Flame, Wind, Fuel, Waves, Scale, Truck, Package, Building2, ShoppingBag, PackageCheck, Receipt, CreditCard, Landmark, BookOpen, Calculator, TrendingUp, IndianRupee, Banknote, Wallet, CircleDollarSign, FileText, Users, Settings, Bell, Menu, X, ChevronDown, ChevronRight, WifiOff, LogOut, RefreshCw, AlertCircle, Sparkles, Radio, Plus`.

### Brand mark
- `assets/MSPIL_logo_transparent.png` — full logo: grey gear-cog ring → green disc → green sugarcane + white lightning bolt. Used on login, letterhead, and generated PDFs.
- `assets/MSPIL_logo.png` — same logo on a solid background.
- `assets/MSPIL_letterhead_hq.jpeg` — printed letterhead with company address, CIN, GSTIN, and contact info.

We consume these as-is. Do not re-draw the logo in SVG — always reference the PNG.

### Emoji
**Never in Tier 2.** Tier 1 plant pages use a small set of process glyphs only if truly helpful. Default: no emoji.

### Unicode glyphs as icons
Very limited: `|` as a subtitle separator in toolbars (`slate-400`); `·` as a meta dot; `₹` for rupee (always). That's it.

### Logos / sprites / icon fonts
- **No** project-owned SVG sprite. No icon font shipped. No custom illustrations.
- **No** CDN icon bundle is added at build time — Lucide is tree-shaken per-import.

---

## File index

| File | What it is |
|---|---|
| `README.md` | This document |
| `SKILL.md` | Agent Skills entrypoint (Claude Code compatible) |
| `colors_and_type.css` | CSS variables + semantic classes for colours, typography, Tier 1/2 primitives |
| `assets/` | Logo, letterhead, brand imagery |
| `preview/` | Small HTML cards shown in the Design System tab (colors, type, spacing, components, brand) |
| `ui_kits/erp/` | High-fidelity React recreation of core ERP screens — login, dashboard, inventory, purchase orders, fermentation |

There is one product — the MSPIL Distillery ERP web app — and therefore one UI kit (`ui_kits/erp/`) covering both Tier 1 and Tier 2.

---

## Font substitution flag

The product uses the **system font stack only** — no webfont is loaded. This design system does the same. If you need to render the ERP in a deck or hand-off where system fonts aren't available, the closest Google Fonts match is **Inter** (400/500/600/700) with **JetBrains Mono** for tabular numbers. Flag this substitution when you use it — the real product does not use either.
