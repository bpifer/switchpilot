# SwitchPilot TODO

Open work is prioritized first (P1 = do next); shipped history and reference
notes are at the bottom. Effort tags: **Easy** ~half day, **Medium** 1-2 days,
**Hard** multi-day / risky. Priority weighs value, effort, and risk. MikroTik
architecture detail lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## P1 - Next up (highest value, do first)

- [ ] **Transactional / commit-confirm pushes (+ self-lockout guard).** `Hard`.
      The #1 trust gap and biggest safety win. `configure()` aborts mid-push on
      `% Invalid` but does NOT roll back already-applied lines, and there is no
      "apply -> verify reachability -> auto-revert if the session drops." Add IOS
      `reload in` + confirm (or `configure replace`); and before applying, detect
      a change that would drop the platform's own mgmt session (uplink/mgmt port,
      an ACL line, a mgmt-path VLAN) and refuse or stage it behind auto-revert.
      (External review independently traced `configure()` and confirmed this is
      the single highest-value fix in the repo - not just in this list.)
- [ ] **SNMP trap receiver (event-driven).** `Medium`. A UDP/162 listener that
      maps common traps (linkUp/Down, etc.) to alerts, mirroring the first-class
      syslog path. Well-scoped, high operational value.

## P2 - High value

- [ ] **Capture command output in the audit log.** `Medium`. Config push +
      firmware audit `{ lines }` (commands) but not device output. Store the
      output (size-capped, secret-redacted) on the audit timeline for high-trust
      ops.
- [ ] **Unified per-device timeline.** `Medium`. Stitch audit log + alerts + git
      config history + jobs into one chronological feed. Data all exists; this is
      aggregation + a timeline component, no new collection.
- [ ] **Platform backup/restore workflow.** `Medium`. In-app DB export/import +
      config bundle (wraps the documented `pg_dump`/restore + git config repo) so
      the whole instance is recoverable, not just per-switch configs.
- [ ] **NetFlow follow-ups.** `Medium`. Add IPFIX (v10) decode (close to v9), a
      driver helper to auto-configure flow export (MikroTik `/ip traffic-flow`
      target, Cisco flow record/exporter/monitor) instead of manual setup, and
      validate end-to-end against the CRS326.
- [ ] **Topology upgrades.** `Medium`. Manual link drawing + persistence,
      orphan-node detection, and MNDP dedup, plus link-utilization + VLAN overlays
      and "what's plugged into what", on top of the CDP/LLDP auto-graph
      (`routes/topology.ts`).
- [ ] **Test the riskiest untested code.** `Medium`. Backend `monitorService` (the
      300+ line poll/refresh pipeline) and `jobService` (claim/retry/reaper) have
      no tests despite being the most failure-prone code, while drivers/parsers/
      crypto/RBAC are well covered. Add unit tests there, then the largest untested
      frontend pages (`Compliance`, `Firmware`, `DeviceDetail`). (External review.)

## P3 - Nice to have

- [ ] **Reads through the driver + split `monitorService`.** `Hard`
      (architecture). Cisco reads (`show ...`) are still inline in
      `monitorService.refreshDevice` while RouterOS uses `routerosMonitor`. Add
      `driver.readCommands`/parser pairs (or `getPorts/getVlans/getNeighbors`) and
      extract a `ciscoMonitor.ts` mirroring `routerosMonitor.ts`. The real
      remaining Cisco coupling (PLAN-multi-vendor #4) and the key architectural
      debt, but no user-facing payoff, so not urgent.
- [ ] **Visual rack view** (U layout of devices). `Medium`. Pure frontend;
      homelab-loved.
- [ ] **Dry-run remediation + scheduled compliance remediation.** `Medium`. Drift
      already auto-remediates vs a pinned baseline; add a dry-run mode and optional
      scheduled remediation for compliance rules.
- [ ] **PoE energy + cost.** `Medium`. Watts over time -> kWh -> dollar figure
      (configurable rate). PoE trends already collected.
- [ ] **DHCP/IPAM correlation.** `Medium`. Pull leases from MikroTik/pfSense/
      Pi-hole and correlate to clients.
- [ ] **Secrets (CREDENTIAL_KEY) rotation.** `Medium`. Re-encrypt all stored
      credentials/MFA secrets old-key -> new-key with key versioning, so rotation
      is non-destructive.
- [ ] **Credential presets (reusable, admin-restricted).** `Medium`. Reusable
      credential sets to speed onboarding / bulk-add; restrict presets to admins.
- [ ] **Credential edit endpoint (`PUT /api/credentials/:id`).** `Medium`. There is
      GET/POST/DELETE but no edit; deleting a credential sets every device's
      `credential_id` to NULL (FK `ON DELETE SET NULL`), so rotating a password by
      delete-and-recreate silently detaches every device using it. Add an in-place
      edit that re-encrypts only changed secrets and keeps devices attached.
      (External review.)

## P4 - Later (large, risky, or niche)

- [ ] **RouterOS firmware.** `Hard`, risky. Package `.npk` upload +
      `/system/reboot` (not `copy http` + `verify /md5`). Driver methods + UI.
      Build + unit-test; do NOT auto-reboot.
- [ ] **Golden config inheritance.** `Hard`. A hierarchy/inheritance model over
      templates + baseline (which already cover most of this).
- [ ] **GitOps / intent-based config.** `Hard`. Declare desired VLANs/port
      profiles in YAML, reconcile against live + flag drift. The drift engine
      helps, but the declarative intent layer is a new subsystem.
- [ ] **Device Tools: packet capture + bandwidth test.** `Hard`. Packet capture
      needs binary `.pcap` retrieval off the device (MikroTik `/tool sniffer` to
      file + fetch, Cisco `monitor capture` + export); bandwidth test is intrusive
      (needs a target/server). Deferred from the shipped Tools tab.
- [ ] **Niche / high-effort.** `Hard`. 802.1X user tracking for endpoints, offline
      config "digital twin" simulation, AI-assisted config analysis (why
      non-compliant / what changed / what broke).
- [ ] **JWT in localStorage -> httpOnly cookie.** `Medium`, acknowledged. Tokens
      live in localStorage (chosen to sidestep CSRF, matching the security audit);
      no XSS vector is known, but if one appears token theft would be total and
      silent. Revisit only if the CSRF tradeoff changes. (External review.)

## Blocked / declined

- [ ] **RouterOS config restore/rollback via `/import`.** Blocked: a `/export` is
      not replayable line-by-line. Proper support = upload the backup + `/import`,
      or `/system reset` + paste. Backups/diff/git history already work for
      RouterOS; only restore is blocked.
- [~] **UniFi driver.** DECLINED (2026-06-14): UniFi has its own controller
      dashboard. Other SSH-managed vendors (Aruba/HPE, Netgear, Brocade/ICX)
      remain candidates via the driver seam.
- [~] **Router-centric features (mikrotik-manager review).** Deliberately skipped
      to keep the multi-vendor switch focus: firewall/Security Center rule builder
      + NAT + address lists, WireGuard VPN, DHCP/DNS/NTP config pages, queues/QoS,
      wireless SSID/CAPsMAN. (The vendor-neutral slice, read-only DHCP/IPAM, is in
      P3.)

## Shipped

**MikroTik bring-up:** onboard + validate CRS326 end-to-end; RouterOS port/VLAN
write config (idempotent bridge-VLAN scripts) + vlan-filtering UI caveat;
vendor-aware onboarding wizard; RouterOS syslog alert rules + severity parsing
(bsd-syslog); vendor-tagged compliance + RouterOS hardening pack; baseline apply
end-to-end; per-port live MAC + bridge-VLAN list; front panel renders RouterOS +
speed colors.

**Homelab features:** Prometheus exporter; MQTT + Home Assistant; SFP/DDM optics;
PoE power-cycle + Wake-on-LAN; PoE budget view + reverse link; more notification
channels (Discord/ntfy/Gotify/Telegram/Pushover); installable PWA; config-history
external git mirror (`CONFIG_HISTORY_REMOTE`).

**Change management & trust:** SSH host-key verification (TOFU pin/refuse/re-pin);
post-change read-back validation (`portVerify`); preview/diff on structured edits
(`configPreview`); fleet health score (`fleetHealth`).

**Architecture, security & DR:** optional `/metrics` auth (`METRICS_TOKEN`);
host-key fingerprint shown at onboarding; DR / upgrade-rollback runbook
(`docs/DISASTER-RECOVERY.md`); daily TLS cert-expiry alert (`certCheck`,
`cert_expiry`); per-device 30-day availability % (`device_availability` hourly
rollup, shown in the device band).

**Cross-tool (mikrotik-manager review):** Device Tools tab (ping/traceroute on
both vendors, ip-scan on RouterOS, injection-safe, audited); NetFlow v5/v9 traffic
analytics (UDP collector + Traffic page; IPFIX/auto-config tracked in P2).

**Code review (session-traced):** `trustProxy: true` on Fastify so `req.ip` is the
real client behind nginx/Ingress (fixes audit-log IPs + the per-IP login throttle);
unified auth - analytics/clients/poe/`/api/summary` switched from a hand-rolled
`jwtVerify` to `requireRole('readonly')`, which also restores API-key (`sp_...`)
access on those endpoints; k8s manifest now persists config-history on its own PVC
and marks firmware + config-history `ReadWriteMany` (with a comment on the
RWX-vs-replicas:1 tradeoff) so `replicas: 2` no longer diverges or wedges.

## Reference

**Cisco-coupling audited:** hardcoded `show`/IOS paths that would break RouterOS
are now vendor-aware via the driver seam (config view/diff/preview, automation
`disable_port`, per-port MACs + VLAN list, syslog baseline, mgmt_ip `host()`
fixes). Remaining Cisco-only spots are intentionally guarded (restore/rollback)
or vendor-tagged (enable-secret remediation). The last big coupling is the read
path - see "Reads through the driver" in P3.

**Already covered (raised in reviews, but built):** sweep concurrency
(`CONCURRENCY=8` worker pool + per-device SSH pool), syslog retention (14-day),
HA (Postgres-advisory-lock leader election + `replicas: 2`), credentials-in-memory
(unavoidable), compliance config caching (regex over the stored backup). MM parity
already in SwitchPilot: 2FA/TOTP + backup codes, RBAC, AES-256-GCM credentials,
audit log, config backup + git history + diffs + rollback, drift/compliance,
maintenance windows, templates, global search, discovery, ring-based firmware
rollouts, endpoint search, capacity trends.
