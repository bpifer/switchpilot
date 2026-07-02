# SwitchPilot TODO

Open work is prioritized first (P1 = do next); shipped history and reference
notes are at the bottom. Effort tags: **Easy** ~half day, **Medium** 1-2 days,
**Hard** multi-day / risky. Priority weighs value, effort, and risk. MikroTik
architecture detail lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## P1 - Next up (highest value, do first)

- [x] **Transactional / commit-confirm pushes (+ self-lockout guard).** `Hard`. **DONE.**
      Self-lockout detection enforced server-side (409 + `force:true`). RouterOS
      commit-confirm validated end-to-end on a CRS326 (backup + scheduler). Cisco
      commit-confirm built and validated end-to-end on a C9300 (IOS-XE 17.3) over
      live SSH: `CiscoSshSession.armRevert(seconds)` issues `reload in N`, handles
      the Save?/Proceed? interactive prompts (skipping Save? when running==startup),
      and `disarmRevert()` issues `reload cancel`; `pushConfigWithRevert` branches
      on `session.armRevert` (Cisco) vs `driver.armRevertLines` (RouterOS); Cisco
      `supportsCommitConfirm` is now `true`. A `reloadInResponse()` pure function
      makes the prompt state machine unit-testable without mocking ssh2 (4 tests
      in `cisco.session.test.ts`). Validated: arm -> show reload shows "scheduled"
      -> cancel -> show reload shows "No reload scheduled". 253 tests pass.
## P2 - High value

- [ ] **Platform backup/restore workflow.** `Medium`. PARTIAL: fleet config-bundle
      download shipped (`/api/config-bundle` - every device's latest config in one
      file, netadmin, audited; "Download configs" on the Devices page). Still open:
      an in-app DB export/import path (the `pg_dump`/restore is documented in the DR
      runbook for now).
- [ ] **NetFlow follow-ups.** `Medium`. IPFIX (v10) decode DONE. RouterOS
      auto-export DONE: `driver.flowExportLines` + `POST /api/devices/:id/flow-export`
      (netadmin, audited) push an idempotent `/ip traffic-flow` target at the
      collector; the target syntax was verified against a live CRS326 7.12.1
      (`dst-address`, `version=9`). Frontend button DONE (2026-07-01): "Enable
      export on this device" on the Traffic page when a device is selected
      (netadmin-gated, also referenced from the empty state). Cisco
      Flexible-NetFlow auto-config BUILT (2026-07-01): record/exporter/monitor
      named SWITCHPILOT with the field set the v9 decoder extracts, monitor
      attached input-side per physical Ethernet port (names from the ports
      table; Po/Vlan/subinterfaces skipped); unit-tested; NX-OS still 501.
      Remaining: (1) **live end-to-end test** - apply `flowExportLines` on the
      CRS326 (and now the C9300) pointed at the LXC collector and confirm
      `flow_records` populate (needs `NETFLOW_ENABLED=true` + udp/2055 reachable
      from the switch); the Cisco FNF lines await that hardware validation.
- [ ] **Topology upgrades.** `Medium`. PARTIAL: orphan-node detection shipped
      (managed devices with no discovered neighbors are flagged on the map +
      counted). Still open: manual link drawing + persistence, MNDP dedup,
      link-utilization + VLAN overlays, and "what's plugged into what", on the
      CDP/LLDP auto-graph (`routes/topology.ts`).
- [ ] **Test the riskiest untested code.** `Medium`. PARTIAL: `jobService` retry/
      backoff (`decideJobOutcome`/`backoffMs`) and `monitorService` health-alert
      decisions (`evaluateHealth`) now have unit tests (pure logic extracted).
      2026-07-01: port flap detection extracted pure (`decidePortFlap`, window
      restart/decay edge cases) + `shortName` exported, both tested; the
      scheduler's sweep worker pool extracted (`forEachLimit`) + tested
      (concurrency cap, per-device error isolation, empty list). Still open:
      the remaining I/O paths of `monitorService.refreshDevice` and the largest
      untested frontend pages (`Compliance`, `Firmware`, `DeviceDetail`).
      (External review.)

## P3 - Nice to have

- [ ] **Reads through the driver + split `monitorService`.** `Hard`
      (architecture). Cisco reads (`show ...`) are still inline in
      `monitorService.refreshDevice` while RouterOS uses `routerosMonitor`. Add
      `driver.readCommands`/parser pairs (or `getPorts/getVlans/getNeighbors`) and
      extract a `ciscoMonitor.ts` mirroring `routerosMonitor.ts`. The real
      remaining Cisco coupling (PLAN-multi-vendor #4) and the key architectural
      debt, but no user-facing payoff, so not urgent.
- [ ] **Dry-run remediation + scheduled compliance remediation.** `Medium`.
      PARTIAL (2026-07-01): dry-run DONE on both paths. Compliance rules:
      `POST /api/compliance/remediate` accepts `dryRun:true` (classifies the fix
      against the live config server-side, so `{platform_host}` substitution
      matches what a real push would send; the Compliance Preview button now
      uses it instead of building lines client-side). Baseline drift:
      `POST /api/devices/:id/baseline/dry-run` previews exactly what
      auto-remediate would replay; `replayableLines` is now shared by drift
      remediation, restore, and rollback. Baseline-management UI shipped
      (same day): Backups tab gets a "set baseline" action per backup, a
      baseline badge, and a Baseline & drift card (auto-remediate toggle +
      dry-run preview + restore-to-baseline). Also fixed a latent bug found
      building it: `checkDrift` auto-remediate on RouterOS would have replayed
      an /export line-by-line - now guarded in the service AND rejected at the
      baseline PUT. Still open: optional scheduled remediation for compliance
      rules.
- [ ] **DHCP/IPAM correlation.** `Medium`. Pull leases from MikroTik/pfSense/
      Pi-hole and correlate to clients.
- [ ] **Credential presets (reusable, admin-restricted).** `Medium`. Reusable
      credential sets to speed onboarding / bulk-add; restrict presets to admins.
- [ ] **Shared toast / mutation hook (frontend).** `Medium`. PARTIAL: a shared
      toast store (`components/Toast`, `toast.error/success/info` + `<Toaster/>`)
      now exists and all 22 browser `alert()` calls across 10 files were migrated
      to it (consistent, non-blocking error/success UX; 409s now surface as a
      toast). 2026-07-01: the mutation hook shipped - `hooks/useAction.ts`
      (busy + per-row `isBusy(key)` + toast-on-error + optional success toast,
      unit-tested) and Compliance (all 3 modals), BackupsTab, Templates,
      Traffic, and DeviceDetail (refresh + host-key re-pin) were migrated.
      This also fixed real bugs: BackupsTab restore/diff and Templates delete
      had NO error handling (a failed restore rejected silently - no toast, no
      busy state); restore now also refetches so the pre-restore snapshot
      appears. Still open: the tabs that surface errors inline in an output
      pane by design (PortsTab, ConfigTab, ToolsTab) don't fit the toast hook -
      they keep their local pattern; migrate the remaining toast-style pages
      (Devices, Firmware, Users, Integrations, Lifecycle) opportunistically.
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
external git mirror (`CONFIG_HISTORY_REMOTE`); PoE energy + cost estimate from the
poe_watts series (`/api/poe/energy`, `POE_RATE_PER_KWH`); visual rack view (place
devices by rack + U in device Settings, migration 026; `/rack` renders the U layout).

**Change management & trust:** SSH host-key verification (TOFU pin/refuse/re-pin);
post-change read-back validation (`portVerify`); preview/diff on structured edits
(`configPreview`) now with a vendor-aware self-lockout guard (`detectMgmtLockout`);
fleet health score (`fleetHealth`); a per-device activity timeline
(`/api/devices/:id/timeline` - config history + alerts + jobs + audited actions
merged into one feed, with a device-detail Timeline tab).

**Architecture, security & DR:** optional `/metrics` auth (`METRICS_TOKEN`);
host-key fingerprint shown at onboarding; DR / upgrade-rollback runbook
(`docs/DISASTER-RECOVERY.md`); daily TLS cert-expiry alert (`certCheck`,
`cert_expiry`); per-device 30-day availability % (`device_availability` hourly
rollup, shown in the device band); SNMP trap receiver (UDP/162 -> alerts for
linkDown/Up, coldStart, authFailure; `snmpTrapService`, mirrors the syslog path,
pure classifier unit-tested); CREDENTIAL_KEY rotation (`npm run rotate-key`
re-encrypts all device + MFA secrets old-key->new-key atomically; key-explicit
crypto unit-tested - bulk transactional re-encryption, not format-versioned key
coexistence).

**Port aggregation:** link-aggregation groups (LACP/static) from 2+ ports - Cisco
EtherChannel (`channel-group N mode active|on`) and RouterOS bridge-aware bonding
(`/interface bonding`: derive bridge, pull members, create bond, re-add); create +
delete validated end-to-end on a CRS326 AND a C9300 (IOS-XE 17.3), where Cisco
delete was corrected to bare `no channel-group` (the `<id>` form is "% Incomplete
command" on IOS-XE); netadmin + audited; a "Create LAG" panel
on the Ports tab. (RouterOS bonds are CPU-forwarded on the switch chip.)
LAG listing + delete UI shipped 2026-07-01: existing LAGs (Po<N>/bond*) are
listed on the Ports tab with status/speed and a delete flow - RouterOS deletes
with a confirm (the device derives the slaves), Cisco asks for the member ports
(membership isn't in the inventory) before detaching channel-groups.

**Bulk port configuration (2026-07-01):** apply one port profile to N selected
ports from the Ports tab - same PortConfigModal + dry-run preview (against the
first selected port) as the single-port flow, then sequential per-port applies
with device read-back verification and a per-port ✓/⚠/✗ report; continues past
failures. Physical ports only (LAG virtuals excluded).

**Live device refresh over WebSocket (2026-07-01):** monitor sweeps (and
status flips) publish a `device_updated` event on the existing redis→/ws bus;
the app invalidates that device's react-query entries (detail, ports, metrics,
device list), so open pages refetch the moment a sweep lands instead of
waiting out their 60s poll. Only active queries refetch - background pages
cost nothing.

**Cross-tool (mikrotik-manager review):** Device Tools tab (ping/traceroute on
both vendors, ip-scan on RouterOS, injection-safe, audited; RouterOS tools
validated live on a CRS326, their continuously-refreshing output collapsed to the
final frame); NetFlow v5/v9 traffic
analytics (UDP collector + Traffic page; IPFIX/auto-config tracked in P2).

**Code review (session-traced):** `trustProxy: true` on Fastify so `req.ip` is the
real client behind nginx/Ingress (fixes audit-log IPs + the per-IP login throttle);
unified auth - analytics/clients/poe/`/api/summary` switched from a hand-rolled
`jwtVerify` to `requireRole('readonly')`, which also restores API-key (`sp_...`)
access on those endpoints; k8s manifest now persists config-history on its own PVC
and marks firmware + config-history `ReadWriteMany` (with a comment on the
RWX-vs-replicas:1 tradeoff) so `replicas: 2` no longer diverges or wedges; an
in-place credential edit endpoint (`PUT /api/credentials/:id` + a Devices.tsx
edit form) that re-encrypts only changed secrets, so password rotation no longer
means delete-and-detach; and direct config pushes (config.push/rollback/restore,
port.config) now capture the device's command output (secret-redacted, size-
capped) into the tamper-evident audit detail, shown in an expandable audit-log
row (job-based pushes already persisted output to `job_results`).

**UX/docs review:** confirm step on the destructive one-click port actions
(Disable/Bounce/PoE-cycle) so a stray click can't drop a link or power-cycle an
AP/camera (Configure already had the preview modal); corrected the
ARCHITECTURE.md "scaling to thousands" section to state current limits honestly
and describe leader election instead of a non-existent `ROLE=worker` split.

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
