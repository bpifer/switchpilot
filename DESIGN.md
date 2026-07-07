# Design

The visual system as implemented (Tailwind utility classes; tokens below are
the committed values in `frontend/tailwind.config.js` and
`frontend/src/components/ui.tsx`). Light-first product UI: white surfaces on a
cool slate canvas, one deep green brand color, status hues reserved for state.

## Theme

Light by default, dark available as an explicit, remembered opt-in — never a
redefault. A network tool is read in lit rooms on desktops and phones as often
as at a dim rack; content (tables, diffs, terminal output) provides the
contrast, not the chrome, in either mode. Toggle lives at the bottom of the
sidebar (`components/ThemeToggle.tsx`); `hooks/useTheme.ts` persists the choice
to `localStorage` and applies a `dark` class to `<html>` (Tailwind
`darkMode: 'class'`), set synchronously by an inline script in `index.html`
before first paint so there's no flash of the wrong theme. Defaults to the OS
`prefers-color-scheme` on first visit, then the explicit choice wins.

Dark surfaces (canvas `slate-950`, cards/modals `slate-800`, borders
`slate-700`) are reached via a `dark:` variant next to nearly every light-mode
color utility — see Color below for the exact ladder. Two surfaces stay fixed
regardless of the toggle because they're already "dark" by their own logic,
not by app theme: the sidebar (`slate-900` band with `white/10` hovers) and
device-output panes (`bg-gray-900` + `text-green-300` — terminal semantics,
quoting the device). Native form controls (checkboxes, file pickers,
scrollbars) follow `color-scheme: dark` rather than needing per-control
overrides.

## Color

- **Brand** (`brand` scale, hex): deep green anchored at
  `brand-500 #0d7a5f` / `brand-600 #0a6650` (primary buttons, active nav, focus
  rings, links). Full ramp 50–900 in `tailwind.config.js`. Usage is
  restrained: ≤10% of any screen; never decorative fills.
- **Canvas & surfaces**: body `slate-50`; cards/headers white with
  `ring-1 ring-slate-200/60` + `shadow-sm`; borders `slate-100/200`.
- **Ink**: `slate-900` body, `slate-700/600` secondary, `slate-400/500` labels
  and section kickers, `slate-300` disabled/empty hints.
- **Status hues (state only, always with a text label)**:
  - green (`green-50/500/700`) — online, connected, done, compliant
  - red (`red-50/500/700`) — offline, failed, critical, destructive actions
  - amber (`amber-50/500/700`) — warning, staged/pending-attention states
  - blue (`blue-50/400/700`) — info, running, in-progress firmware
  - slate — unknown, disabled, notconnect
- **Port speed colors (front panel)**: 10G blue, 1G green, 10/100 orange —
  mirrors physical-world labeling conventions.
- **Dark-mode ladder** (each light utility pairs with a `dark:` sibling):
  surfaces `bg-white → dark:bg-slate-800`, `bg-slate-50 → dark:bg-slate-800/50`
  (canvas fills), `bg-slate-100 → dark:bg-slate-700/50`; borders
  `border-slate-200 → dark:border-slate-700`; ink `text-slate-900/800 →
  dark:text-slate-100`, `text-slate-700 → dark:text-slate-300`,
  `text-slate-500/600 → dark:text-slate-400`, `text-slate-400 →
  dark:text-slate-500` (each step gets one notch lighter as the ladder
  descends, keeping the same relative contrast against its dark surface).
  Status-hue tints swap the light `bg-{color}-50/100` fill for a translucent
  `dark:bg-{color}-500/10` and brighten text to `dark:text-{color}-400` —
  never the light `-50/100` tint verbatim on a dark surface (reads as a washed
  pastel box). Saturated `-500` dot/fill colors (status dots, sparkline lines,
  port-speed swatches) are left unpaired — already legible on both surfaces.

## Typography

- System UI stack (Tailwind default `font-sans`); no webfonts — instant load,
  native feel per platform.
- Scale in practice: `text-lg font-semibold` page titles; `text-sm
  font-semibold` card titles; `text-sm` body/tables; `text-xs` metadata and
  table headers (headers additionally `uppercase tracking-wide text-slate-500`);
  `text-[10px]/[11px] font-semibold uppercase tracking-wide text-slate-400`
  stat/inline labels.
- `font-mono` for machine identifiers: IPs, serials, MACs, port names,
  versions, filenames, config text. This is a semantic rule, not a style
  choice — mono means "exact string from the network".

## Components (frontend/src/components/ui.tsx)

- **PageHeader** — sticky white bar, title left, actions right (`z-10`).
- **Card** — `rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60`,
  optional titled header row.
- **Button** — `rounded-lg px-3.5 py-2 text-sm font-medium`; variants:
  `primary` (brand-600), `secondary` (white, slate border), `danger`
  (red-600). Danger is reserved for genuinely destructive/disruptive acts.
- **StatusBadge** — pill with colored dot **and** the status word; the single
  source of truth for state colors.
- **Modal** — centered, `rounded-2xl`, `bg-black/50 backdrop-blur-sm`
  overlay, click-outside closes (`z-50`).
- **Field / inputCls** — labeled block; inputs `rounded-lg border-slate-300`
  with `focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500`.
- **Toast** (`components/Toast`) — non-blocking error/success/info; the
  standard error surface for actions without an inline output pane.
- **PortGrid** — the graphical front panel (RJ45 vs SFP rendering, speed
  colors); the app's signature component.
- Output panes — `rounded-lg bg-gray-900 p-3 text-xs text-green-300`
  scrollable `pre` for device CLI output.

## Layout

- App shell: fixed dark sidebar (static ≥lg, off-canvas drawer below with a
  mobile top bar), content area scrolls; page content padded `p-6`
  (`px-4 sm:px-6` on dense pages).
- Data pages: full-width tables inside Cards, `divide-y divide-slate-50`
  rows, `hover:bg-slate-50/80` row hover; column headers as described above.
- Forms live in Modals; two-column `grid grid-cols-2 gap-3` where fields
  pair naturally.
- Spacing rhythm: `space-y-4` between cards, `gap-2/3` within control rows,
  `p-5` card interiors.
- z-index scale in use: content `z-10` (sticky header) → modal `z-50`;
  keep new layers within this ladder (toast above modal).

## Motion

Nearly none, deliberately: `transition-colors` on interactive elements and the
drawer slide are the whole vocabulary. Spinners (`animate-spin`) communicate
loading. Anything new must honor `prefers-reduced-motion`.

## Voice (UI copy)

- Labels are nouns, buttons are verbs ("Reboot to apply", "Configure 3
  port(s)…").
- Risk is stated in the confirm, concretely: "This drops the link on this
  port", "unreachable for 1–2 minutes".
- Unknown data is "—" or "no data", never 0.
- Helper text under controls explains device-side consequences in one line.
