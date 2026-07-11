# SwitchPilot TODO

Open work first (P1 = do next), then blocked/declined, then a condensed record
of shipped work. Effort tags: **Easy** ~½ day, **Medium** 1–2 days, **Hard**
multi-day / risky. Priority weighs value × effort × risk. Multi-vendor
architecture detail lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

The app is mature and production-deployed (Proxmox LXC). What remains is polish,
niche subsystems, dependency modernization, and hardware-gated validation.

---

## Open — prioritized

### P1 — highest value next

- [~] **Response schemas on the remaining routes.** `Medium`. The hot
      fixed-shape/computed endpoints now have 200 schemas (2026-07-11):
      `/api/health`, `/api/summary`, `/api/compliance/summary`,
      `/api/poe/energy` (plus the Traffic API earlier), all with
      `additionalProperties: true` — proven anti-strip via the real serializer.
      REMAINING is only the `SELECT *` list endpoints (devices/alerts/etc., ~36
      mixed nullable cols): high tedium, and with additionalProperties:true they
      gain only `/docs` documentation, no perf/anti-strip benefit. Low priority
      — do opportunistically if `/docs` completeness matters.
### P2 — high value, situational

- [ ] **Aruba Instant On 1930 — live validation.** `Medium`. BLOCKED on the 1930
      being reachable from the LXC (it has been offline / off-subnet). Code is
      built + unit-tested; when it's online, validate against real state: PVID
      walk populates `ports.vlan`, a synthetic backup lands in `config_backups` +
      git, the 5 seeded compliance rules score sensibly, and onboarding e2e via
      the `probe-aruba` wizard step. (Health gauges are permanently N/A —
      confirmed 2026-07-10 the 1930 exposes no CPU/mem/temp OIDs.)
- [ ] **Commit-confirm armed badge (UI) + manual-mode e2e.** `Easy`. The backend
      is fully validated (Cisco classic-IOS + IOS-XE + RouterOS). What's left is
      visual: push in manual/test mode, watch the amber "auto-revert armed until
      HH:MM" badge appear and clear on accept, and exercise the revert-timeout
      path — needs a human watching the frontend.

### P3 — nice to have

- [ ] **Tailwind 4 migration (frontend).** `Medium`. New engine + config format;
      pinned out in dependabot until done deliberately. The last frontend major
      (React 19 + Vite 8 + recharts 3 shipped 2026-07-11).
- [ ] **`driver.readCommands` / parser-pair abstraction.** `Hard` (architecture).
      The monitor split is done (`ciscoMonitor` / `routerosMonitor` / `arubaMonitor`
      + shared `monitorShared`), but each vendor still needs its own monitor
      module. Abstracting the read path so a 4th vendor plugs in without one has
      no payoff until that vendor actually appears — defer until then
      (PLAN-multi-vendor #4).
- [ ] **NX-OS Flexible NetFlow + Cisco collector delivery.** `Medium`, niche.
      NX-OS FNF auto-config still returns 501 (no NX-OS hardware to validate).
      Cisco→collector NetFlow delivery is untested only because the lab C9300 was
      on a different subnet from the collector; the config path is validated.
- [ ] **DHCP/IPAM correlation.** `Medium`. Pull leases from MikroTik/pfSense/
      Pi-hole and correlate to clients. SKIPPED by user call (2026-07-09); the
      vendor-neutral read-only slice only.

### P4 — large / risky / niche

- [ ] **Golden config inheritance.** `Hard`. Hierarchy/inheritance over templates
      + baseline (which already cover most of this).
- [ ] **GitOps / intent-based config.** `Hard`. Declare desired VLANs/port
      profiles in YAML, reconcile against live. New subsystem on top of the drift
      engine.
- [ ] **Device Tools: packet capture + bandwidth test.** `Hard`. Binary `.pcap`
      retrieval (MikroTik `/tool sniffer`, Cisco `monitor capture` + export);
      bandwidth test is intrusive (needs a target server).
- [ ] **Niche / high-effort.** `Hard`. 802.1X user tracking for endpoints, offline
      config "digital twin" simulation, AI-assisted config analysis.
- [ ] **JWT in localStorage → httpOnly cookie.** `Medium`, acknowledged tradeoff.
      Chosen to sidestep CSRF, matching the security audit; no XSS vector known,
      but if one appeared token theft would be total and silent. Revisit only if
      the CSRF tradeoff changes.

---

## Blocked / declined

- [ ] **RouterOS config restore/rollback via `/import`.** BLOCKED: a `/export` is
      not replayable line-by-line. Proper support = upload the backup + `/import`,
      or `/system reset` + paste. Backups/diff/git history already work for
      RouterOS; only restore is blocked.
- [~] **Credential presets.** Effectively COVERED: the `credentials` table is
      already a reusable, netadmin-restricted, named set attachable to devices
      and usable in bulk CSV import, and the onboarding wizard grew a
      credential-profile quick-pick (2026-07-09). A separate "presets" table would
      duplicate it; not building unless a concrete gap appears.
- [~] **UniFi driver.** DECLINED (2026-06-14): UniFi has its own controller.
      Other SSH-managed vendors (Aruba/HPE, Netgear, Brocade/ICX) remain
      candidates via the driver seam.
- [~] **Router-centric MikroTik features.** DECLINED to keep the multi-vendor
      switch focus: firewall rule builder + NAT + address lists, WireGuard,
      DHCP/DNS/NTP pages, queues/QoS, wireless SSID/CAPsMAN.

---

## Shipped

### Security & dependencies (2026-07-10 → 07-11)
- **Fastify 5 migration** — clears a critical `fast-jwt` advisory chain (incl. a
  JWT auth-bypass) + high-severity `fast-uri`; also nodemailer 9, node-cron 4,
  uuid. `npm audit --omit=dev` clean. Only code change: `@fastify/websocket` v11
  hands the socket directly.
- **Immediate session revocation** — `users.token_valid_after` (migration 033);
  `requireRole` re-checks the live user row (30s cache, bustable): disabled
  accounts 401, DB role overrides the token claim, tokens pre-cutoff rejected.
  Set on password change/reset, role change, disable. Self-change returns a
  fresh token.
- **Boot-time secret guard** — the API refuses to start in production on a
  placeholder/short `JWT_SECRET` or non-64-hex `CREDENTIAL_KEY`, so a copied
  `.env.example` can't ship forgeable logins. Plus `npm run reset-password`
  break-glass (audited one-time password, optional `--clear-mfa`).
- **Dependency modernization** — merged 11 Dependabot PRs (GitHub Actions,
  Node 20→26 images, nginx 1.31, minor groups, `diff` 9, react-router 7,
  bcryptjs 3, TypeScript 7, `@types/*`); manually took vitest 4 + cron-parser 5.
  Dependabot majors now grouped (≤2 PRs/tree/week). **React 19 + Vite 8 +
  recharts 3** migrated 2026-07-11 (build + 62 tests + live chart render
  verified). Tailwind-4 and otplib-13 majors still ignored pending deliberate
  migrations.

### Live hardware validation (2026-07-11, via the API on the LXC)
- **2960 (SW-ACCESS-01, classic IOS 15.2):** TDR cable test, config preview
  diff, config apply with device read-back + restore, port bounce, EtherChannel
  create→delete→refresh-confirmed cleanup, **uplink guard** end-to-end (force=
  false → 409 blocked, force=true → override), on-demand backup, and
  **classic-IOS commit-confirm** in auto mode (`reload in` → apply → probe →
  `reload cancel` + `write memory`, outcome "confirmed", no reboot). Fixed a
  stale comment that wrongly claimed Cisco commit-confirm 501s.
- **MikroTik (CRS326):** bond create→delete on spare ports, management path
  (ether24) intact throughout. Neighbor discovery still returns 0 (known gap).

### Aruba Instant On 1930 (SNMP-only vendor)
- Full read + write over SNMP (Q-BRIDGE / IF-MIB): port admin/bounce/description,
  access + trunk VLANs via MSB-first bitmaps, PVID walk into `ports.vlan`.
- Synthetic config snapshot from SNMP state feeds the existing history / diff /
  compliance engine (migration 032 seeds 5 vendor=aruba rules). Health gauges
  show "not reported by this platform" (probed 1930 exposes no health OIDs).
- Per-tab frontend gating for a CLI-less device (Config/Backups/History).

### Demo mode & test infra
- **Demo mode** (`DEMO_MODE=true`) seeds a fake 4-device fleet (Cisco 9300 +
  2960X, MikroTik, Aruba 1930) with ports, PoE, endpoints, topology, 48h metrics,
  alerts, and config diffs. Inert by construction (never polled, refuses live
  actions, TEST-NET-1 IPs).
- **CML test bench** — EEM→console capture from virtual IOS switches feeds
  parser regression fixtures; found + fixed an `interfaces-status` bug where a
  port description containing a status word ("kept down") shifted columns.
- Riskiest code now unit/integration-tested: job retry/backoff, health-alert
  decisions, port-flap detection, sweep worker pool, SSH chaos (enable prompts,
  echo, `--More--`), `refreshCiscoDevice` full-sweep integration, Aruba bitmaps,
  frontend device-tab flows.

### Release engineering & production readiness
- Multi-arch (amd64/arm64) images to ghcr.io on version tags; `docker-compose.
  release.yml`; `CHANGELOG.md`; CI smoke test (fresh boot + all migrations +
  auth + login on the real compose stack); `SECURITY.md`, dependabot, issue
  templates, `CONTRIBUTING.md`; per-device diagnostics bundle (read-only,
  redacted) for bug reports; README hardware matrix (validated vs should-work
  vs beta) + tested-scale envelope.

### Core platform (earlier)
- **Config management:** scheduled + on-demand git-backed backups, history/diff/
  rollback (Cisco), baseline + drift with dry-run and opt-in scheduled
  auto-remediation (triple-gated), fleet config-bundle download, in-app DB
  backup/restore (superadmin pg_dump + confirm=RESTORE + pre-restore safety dump).
- **Commit-confirm / safe apply:** server-side self-lockout guard (409 +
  `force`), RouterOS (scheduler + backup) and Cisco (`reload in` / `reload
  cancel`) auto-revert; armed-badge redis key + `revert_armed_until`.
- **Ports:** graphical front panel, enable/disable/bounce, PoE power-cycle, TDR,
  VLAN config with preview/diff, SFP DDM, LAG create/delete (EtherChannel +
  RouterOS bonding), bulk port configuration with per-port read-back, uplink
  guard (discovered + manual neighbors).
- **Monitoring & alerts:** polling + syslog + SNMP traps, port-flap detection,
  30-day availability, TLS cert expiry, maintenance windows, fleet health score,
  notifications (email/Slack/Teams/Discord/ntfy/Gotify/Telegram/Pushover/signed
  webhooks) with retry/backoff.
- **Topology:** CDP/LLDP/MNDP + manual link drawing/persistence, orphan
  detection, link-utilization + VLAN overlays, persistent node positions.
- **Homelab integrations:** Prometheus `/metrics` (+ optional token), Home
  Assistant via MQTT discovery, NetFlow/IPFIX collector + Traffic analytics
  (Cisco FNF auto-config hardware-validated; RouterOS auto-export), PoE budget +
  energy/cost estimate, visual rack view, installable PWA, config-history git
  mirror.
- **Endpoints/tools:** MAC/IP/port tracking with OUI + reverse DNS + Wake-on-LAN,
  Device Tools tab (ping/traceroute/ip-scan, injection-safe + audited),
  interactive SSH terminal (nonce auth + idle timeout), global search, discovery
  one-click add, ring-based firmware rollouts, RouterOS staged firmware upgrades,
  Cisco lifecycle (EoS/EoL), scheduled + event-driven automation.
- **Security & trust:** RBAC (4 roles), local + LDAP auth, TOTP MFA + recovery
  codes, AES-256-GCM credential vault with key rotation + break-glass reveal,
  SSH host-key pinning (TOFU), hash-chained audit log, `sp_` API keys, rate
  limiting, `trustProxy` for real client IPs.

---

## Reference

- **Cisco-coupling audited:** hardcoded `show`/IOS paths are vendor-aware via the
  driver seam; remaining Cisco-only spots are intentionally guarded (restore/
  rollback) or vendor-tagged (enable-secret remediation). The last coupling is
  the read path — see `driver.readCommands` in P3.
- **Deliberately not done:** splitting `configs.ts` (cohesive routes, churn
  without payoff); per-frame WS crypto (wss + nonce + role check + audit is the
  standard model); TimescaleDB / worker-thread telemetry (wrong scale; retention
  pruning caps growth); PortGrid virtualization (a front panel is a few hundred
  nodes).
- **Deploy:** private repo → the LXC can't `git pull`; push a git bundle over SSH
  and `docker compose up -d --build`. Details in the deployment memory.
