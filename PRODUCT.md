# Product

## Register

product

## Users

Homelab operators and small-network admins managing a mixed fleet of Cisco
(IOS/IOS-XE/NX-OS), MikroTik (RouterOS), and Aruba Instant On switches —
typically a handful to a few dozen devices they personally own and are
personally on the hook for. Two contexts: at a desk doing deliberate work
(config changes, compliance review, firmware planning), and on a phone standing
at a rack ("which port is the dead AP on?", "bounce it", "is it back?"). They
are technical, allergic to vendor cloud lock-in, and value correctness over
gloss: a wrong port label is worse than a plain one.

## Product Purpose

SwitchPilot is a self-hosted, single-pane dashboard for multi-vendor switch
management over SSH/SNMP: live monitoring (status, ports, PoE, optics,
traffic), safe configuration (previewed diffs, self-lockout guards,
commit-confirm auto-revert, post-apply read-back), config backup with git
history and drift/compliance scoring, alerting/automation, and firmware
management. Success looks like: an operator makes a change from the couch that
they'd previously have needed a console cable for, and never once wonders
whether it actually landed.

## Brand Personality

Calm, precise, operator-grade. The tone of a good senior network engineer:
explains what will happen before it happens, states what did happen plainly,
never dramatizes. Trust is the product — the UI earns it with visible
guardrails, honest nulls ("—" over fake zeros), and exact language.

## Anti-references

- **Meraki/DNA-Center cloud gloss**: marketing-grade dashboards with big empty
  hero metrics, illustration-heavy empty states, and feature upsells.
- **"Hacker NOC" dark theaters**: default dark UI, glowing accents, animated
  world maps. This is a tool you read in a lit room, not a screensaver.
- **Enterprise bloatware (Cisco Prime)**: nested tab mazes, ten-click paths,
  modal-on-modal wizards.
- Generic admin-template look (identical stat-card rows, gradient accents).

## Design Principles

1. **Safety is visible.** Anything that touches a device shows its blast
   radius up front: preview diffs, explicit confirms scaled to the risk (a
   typed word for destructive ops), progress during, read-back after. The
   riskier the action, the more friction and the more explanation.
2. **Status is color + text, never color alone.** Green/red/amber carry
   meaning consistently everywhere (chips include the word; badges include the
   count). Color is state, not decoration.
3. **Dense but legible.** Operators want tables, monospace identifiers, and
   many facts per screen — served with clear hierarchy, not whitespace-starved
   clutter and not consumer-app sparseness.
4. **One mental model across vendors.** Cisco, MikroTik, and Aruba read the
   same on screen; vendor differences surface only where they genuinely differ
   (and then explicitly, e.g. "RouterOS applies immediately — no save step").
5. **Honest by default.** Unknown data renders as unknown ("—", "no data"),
   never as zero. Errors surface where the user acted, in plain language, with
   the device's own output when it explains more.

## Accessibility & Inclusion

- WCAG 2.1 AA contrast as the working bar (4.5:1 body text, 3:1 large/UI).
- Status never communicated by hue alone (text labels accompany every chip).
- Full keyboard operability for forms and modals; visible focus rings
  (brand-colored ring on inputs already standard).
- Minimal-motion UI by nature; any added motion must respect
  `prefers-reduced-motion`.
- Mobile-first responsiveness is a real requirement (rack-side phone use), not
  a checkbox: 375px layouts are maintained and tested.
