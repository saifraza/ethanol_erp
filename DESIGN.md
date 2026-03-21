# MSPIL Distillery ERP — Design System

## Color Palette

### Primary (Blue)
| Token | Hex | Usage |
|-------|-----|-------|
| primary-500 | `#3b82f6` | Charts, icons, secondary accents |
| primary-600 | `#2563eb` | Buttons, active nav, links |
| primary-700 | `#1d4ed8` | Hover states |

### Neutrals (Gray)
| Token | Hex | Usage |
|-------|-----|-------|
| bg-page | `#f9fafb` | Page background (gray-50) |
| bg-card | `#ffffff` | Card backgrounds |
| border | `#e5e7eb` | Card/input borders (gray-200) |
| text-primary | `#111827` | Headings, body text (gray-900) |
| text-secondary | `#6b7280` | Labels, captions (gray-500) |
| text-muted | `#9ca3af` | Placeholder text (gray-400) |

### Semantic Colors (Status Only)
These are ONLY for process phase indicators, status badges, and alerts:
| Color | Hex | Usage |
|-------|-----|-------|
| emerald-600 | `#059669` | Success, completed |
| red-600 | `#dc2626` | Error, danger, delete |
| amber-500 | `#f59e0b` | Warning, in-progress |
| indigo-500 | `#6366f1` | Filling phase, setup |
| cyan-500 | `#06b6d4` | Retention, holding |
| purple-500 | `#8b5cf6` | CIP, special status |

**Rule**: Semantic colors go on badges/indicators only — never on primary action buttons.

## Typography
- **Font**: System default (`ui-sans-serif, system-ui, sans-serif`)
- **Headings**: `font-semibold` or `font-bold`, gray-900
- **Body**: `text-sm` (14px), gray-700/gray-900
- **Labels**: `text-xs` (12px), gray-500, sometimes uppercase

## Components

### Buttons
Always use CSS classes from `index.css`:
```
.btn-primary   → blue-600 bg, white text, hover blue-700
.btn-secondary → gray-200 bg, gray-700 text, hover gray-300
.btn-danger    → red-600 bg, white text
```
**Never** use inline `bg-emerald-600 px-4 py-2` for action buttons.

### Cards
```
.card → white bg, border gray-200, shadow-sm, rounded-md, p-4 (md:p-6)
```

### Inputs
```
.input-field → border gray-300, focus blue-500 ring
.input-auto  → green bg (computed/auto-filled fields)
```

### Section Titles
```
.section-title → text-base font-semibold, border-bottom gray-200
```

## Layout
- **Sidebar**: Dark (`bg-gray-900`), white text, blue-600 active state
- **Main content**: `bg-gray-50` (`#f9fafb`)
- **Mobile**: Hamburger menu, slide-out sidebar

## Phase Color Map (Standard)
All fermentation/process pages must use these same colors:
```js
const phaseColors = {
  FILLING:   '#6366f1', // indigo
  SETUP:     '#6366f1', // indigo
  DOSING:    '#f59e0b', // amber
  REACTION:  '#22c55e', // green
  LAB:       '#10b981', // emerald
  RETENTION: '#06b6d4', // cyan
  TRANSFER:  '#3b82f6', // blue
  CIP:       '#8b5cf6', // purple
  DONE:      '#6b7280', // gray
};
```
