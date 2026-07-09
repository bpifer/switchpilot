# SwitchPilot TODO

Open work is prioritized first (P1 = do next); shipped history and reference
notes are at the bottom. Effort tags: **Easy** ~half day, **Medium** 1-2 days,
**Hard** multi-day / risky. Priority weighs value, effort, and risk. MikroTik
architecture detail lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## Recommended order (2026-07-03 re-prioritization, w/ rough effort)

The app is mature; what's left is mostly polish, niche features, or big new
subsystems. Best value-per-effort next, in order:

1. ~~Response schemas on hot routes~~ **DONE 2026-07-03.** Traffic API
   (status/top-talkers/apps/series) now declares 200 schemas (additionalProperties
   -safe, date-time formats), verified live. The SELECT * device/alert endpoints
   are intentionally left unschemaed (36 mixed/nullable cols; high tedium, no
   anti-strip benefit).
2. ~~Scheduled compliance remediation~~ **DONE 2026-07-03.** Opt-in, triple-gated
   (global COMPLIANCE_AUTO_REMEDIATE master switch + per-rule auto_remediate flag
   + maintenance-window suppression), audited, reuses the proven remediate()
   path. UI toggle + auto-fix badge on the Compliance rules editor. Off by default.
3. ~~Topology link-utilization + VLAN overlays~~ **DONE 2026-07-03.** Plain/
   Utilization/VLAN toggle on the map; edges enriched with local-port VLAN, link
   speed, and live utilization % (port_metrics bandwidth vs speed, null-safe);
   link hover shows a detail card. Verified live (VLAN overlay renders the trunk
   link).
4. ~~In-app DB backup/restore~~ **DONE 2026-07-06.** Superadmin-only pg_dump
   streaming download + destructive restore (confirm=RESTORE + safety dump of the
   current DB first), on the Users page. Old pre-restore safety dumps pruned daily
   (>7d). postgresql16-client bundled in the API image.
5. **Aruba InstantOn 1930** — phase 1 (SNMP read-only monitor) BUILT 2026-07-06;
   phase 2 (full SNMP write layer: port admin/bounce/description, access +
   trunk VLANs via Q-BRIDGE bitmaps, validated against the real 1930) shipped
   2026-07-08; compliance shipped 2026-07-09 (commit b2c6e45): the monitor
   walks PVIDs into `ports.vlan`, backups render a synthetic snapshot from
   SNMP state (config history + diffs for CLI-less devices), and migration
   032 seeds 5 vendor=aruba rules (VLAN-1 exposure, port descriptions,
   default hostname, LLDP visibility, firmware identified). REMAINING (needs
   the live 1930 reachable from the LXC): CPU/mem/temp vendor OIDs, PVID walk
   + synthetic backup + rule scoring against real state, onboarding wizard
   end-to-end via the new probe-aruba step.

Lower value / defer: remaining `useAction` page migrations (cosmetic, ~½ day),
NX-OS Flexible NetFlow (niche, no hw), manual topology link-drawing (~2 days),
`driver.readCommands` abstraction (Hard, no payoff until a 3rd vendor), DHCP/IPAM
correlation (~2 days, homelab-nice). Credential presets need a scoping decision
first (likely duplicates the existing `credentials` table). All P4 items are
Hard/niche. See sections below for detail.

## Deferred from external review (2026-07-02, round 2)

- [ ] **Response schemas on routes.** `Medium`. 0/28 route files declare Fastify
      response schemas, so `/docs` shows every response as an empty object and
      responses use generic JSON.stringify (not the faster schema serializer).
      DEFERRED (needs running-stack verification): fast-json-stringify strips
      any undeclared property by default, and most handlers return `SELECT *`
      with many varied-typed columns - an incomplete/mistyped schema would
      silently drop fields the SPA needs, which can't be verified offline
      (LXC-only). Do per-route WITH the app running to diff responses, using
      `additionalProperties: true` to be safe.
- [ ] **Credential presets (P3).** `Medium`. Needs scoping: the existing
      `credentials` table already IS a reusable, netadmin-restricted, named
      credential set attachable to devices and usable in bulk CSV import
      (`credential_id`). A separate "presets" table would largely duplicate it.
      Clarify what a preset adds (superadmin-only vs netadmin? an
      onboarding-wizard quick-pick?) before building, to avoid a redundant
      subsystem.
- [x] **Webhook/notifier delivery retry.** `Medium`. **DONE 2026-07-02.** A
      shared `util/httpRetry.ts` (`fetchWithRetry`, unit-tested) retries
      transient failures - network error / timeout / 5xx / 429 - with
      exponential backoff, and never retries a 4xx (permanent misconfig).
      `fireWebhooks` uses it (last_status now notes "gave up after N tries")
      and `dispatchNotifications` (Discord/ntfy/Gotify/Telegram/Pushover) too.
      Teams/Slack now route through `fetchWithRetry` as well (DONE 2026-07-06);
      only SMTP still fires once (its own transport retry is a separate concern).

Fixed this round (see Shipped): compliance staleness, automation vs maintenance
windows, NetFlow row dedup, commit-confirm double-fetch, safe-apply label +
reboot clarification, CSV import messages, CSP upgrade-insecure-requests, and
the Campaigns silent-catch (+ a double-stringify bug found there). The CSV
"duplicate rows" claim was wrong (`mgmt_ip` is already UNIQUE); only its error
message needed cleanup.

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

- [x] **Platform backup/restore workflow.** `Medium`. **DONE 2026-07-06.** Fleet
      config-bundle download (`/api/config-bundle`, netadmin, audited; "Download
      configs" on the Devices page) plus the in-app DB backup/restore that shipped
      the same day (superadmin pg_dump download + confirm=RESTORE restore with a
      pre-restore safety dump; see item 4 in the recommended-order list).
- [ ] **NetFlow follow-ups.** `Medium`. IPFIX (v10) decode DONE. RouterOS
      auto-export DONE: `driver.flowExportLines` + `POST /api/devices/:id/flow-export`
      (netadmin, audited) push an idempotent `/ip traffic-flow` target at the
      collector; the target syntax was verified against a live CRS326 7.12.1
      (`dst-address`, `version=9`). Frontend button DONE (2026-07-01): "Enable
      export on this device" on the Traffic page when a device is selected
      (netadmin-gated, also referenced from the empty state). Cisco
      Flexible-NetFlow auto-config BUILT (2026-07-01) and **hardware-validated
      (2026-07-02)** on a C9300-24T, IOS-XE 17.03.07: all 84 generated lines
      accepted with zero % messages, record/exporter/monitor verified on
      device, monitor attached input-side on all 32 physical ports (AppGig
      correctly filtered out), re-applying the identical config is a clean
      no-op (17.3 emits no "in use" warnings for identical fields), cleanup
      verified, startup untouched. The same session validated the full
      ciscoMonitor read path (all parsers + capability gating: PoE command
      skipped on the non-PoE 24T, layer3 ARP taken, stack parsed) and the
      commit-confirm arm/cancel mechanics post-refactor. NX-OS still 501.
      Collector end-to-end **DONE 2026-07-03** (CRS326 7.12.1 -> dockerized LXC):
      enabled NETFLOW on the LXC, pushed flow-export via the API, flows decode
      and the Traffic API returns top-talkers + app breakdown. Found + fixed a
      real bug - RouterOS exported from source 0.0.0.0 (no src-address), which
      docker/kernel drops as a martian source; `flowExportLines` now pins
      `src-address` to the device IP (commit d7d6acb). NetFlow left ENABLED on
      the lab LXC. Remaining: only NX-OS Flexible NetFlow (still 501, niche, no
      NX-OS hardware) and Cisco collector delivery (C9300 is on a different
      subnet from the collector - not routable in the lab).
- [x] **Topology upgrades.** `Medium`. **DONE 2026-07-06.** Orphan-node
      detection, link-utilization + VLAN overlays (2026-07-03), and now manual
      link drawing + persistence: `manual_topology_links` (migration 031),
      netadmin CRUD (audited), dashed rendering with click-to-delete, external
      free-text targets merging with discovered `ext:` nodes, and manually-linked
      devices no longer flagged orphan. Node drag positions persist per browser
      (localStorage). MNDP dedup was already covered: `/ip neighbor` merges
      protocols on-device and the graph's edge key + ON CONFLICT dedupe the rest.
      "What's plugged into what" is served by per-port learned MACs + Clients.
- [ ] **Test the riskiest untested code.** `Medium`. PARTIAL: `jobService` retry/
      backoff (`decideJobOutcome`/`backoffMs`) and `monitorService` health-alert
      decisions (`evaluateHealth`) now have unit tests (pure logic extracted).
      2026-07-01: port flap detection extracted pure (`decidePortFlap`, window
      restart/decay edge cases) + `shortName` exported, both tested; the
      scheduler's sweep worker pool extracted (`forEachLimit`) + tested
      (concurrency cap, per-device error isolation, empty list). Frontend:
      the new device-tab flows now have behavioral tests (33 total) -
      `BackupsTab` (baseline set/badge/auto-remediate/dry-run, the RouterOS
      variant, and a regression for the once-silent restore failure) and the
      bulk port configuration flow (preview-first-port, per-port apply,
      continue-past-failure, read-back mismatch reporting, confirm-decline).
      Compliance + Firmware page tests shipped (tasks 29/30). SSH chaos gap
      CLOSED 2026-07-06: mockCiscoDevice gained enable-password prompts, command
      echo, and --More-- pagination; ssh.chaos covers enable-password, skip-enable
      pass-through, echo-in-separate-chunk stripping, and paging. Auto-remediation
      safety default (off-by-default short-circuit) unit-tested. Devices
      filter/sort + Alerts ack/resolve/edit page tests added. Still open: the
      remaining I/O paths of the vendor monitors — a full `refreshCiscoDevice`
      test needs a session-injection seam (sshTargetFor hard-codes port 22), a
      hot-path refactor deferred as out of scope for a test-only change.

## P3 - Nice to have

- [ ] **Reads through the driver + split `monitorService`.** `Hard`
      (architecture). PARTIAL (2026-07-01): the split is DONE - the Cisco read
      path was extracted verbatim to `services/ciscoMonitor.ts` (mirroring
      `routerosMonitor.ts`), the shared decision logic (evaluateHealth, flap
      detection, shortName) to `services/monitorShared.ts`, and
      `monitorService` is now the vendor-neutral dispatcher (pollStatus +
      refreshDevice; helpers re-exported so importers/tests are unchanged).
      Line-identical move verified mechanically; 278 tests pass. Still open:
      the `driver.readCommands`/parser-pair abstraction so a third vendor
      (Aruba/ICX) plugs in without a new monitor module (PLAN-multi-vendor #4).
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
      Pi-hole and correlate to clients. SKIPPED for now (user call, 2026-07-09).
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

- [x] **RouterOS firmware.** `Hard`. **DONE 2026-07-03, hardware-validated.**
      Reads both firmware layers - RouterOS package (version/channel/latest via
      check-for-updates) and RouterBOARD bootloader (current vs bundled) - and
      offers STAGED, non-disruptive upgrades: `/system package update download`
      and `/system routerboard upgrade` stage without rebooting; a separate
      explicit reboot (confirm=REBOOT, tolerates the self-disconnect) applies
      them. Never auto-reboots. Netadmin + audited; MikroTik-only firmware panel
      on the device page; parser + tests on real output. VALIDATED live on the
      CRS326: staged + rebooted the bootloader 6.48.6 -> 7.12.1 via the API,
      device came back in ~1 min, firmware confirmed upgraded, RouterOS version
      unchanged. Not done: SwitchPilot-HOSTED .npk fetch (router pulls a pinned
      package from the platform via /tool fetch, for air-gap / ring rollouts) -
      the built-in updater is better for connected switches; the hosted path is
      a future follow-up that would reuse the firmware library + campaigns.
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

**Topology + discovery + polish (2026-07-06, round 2):** manual topology links
(see P2 item above); Discovery one-click add (each CDP/LLDP suggestion row gets
an "Add…" button opening the onboarding wizard with the IP prefilled);
auto-remediation skips during maintenance windows are now audited
(`compliance.auto_remediate.skipped`, only when work was actually suppressed);
MikroTik low-disk firmware panel explains the Netinstall path and hides the
futile Download button; silent-failure mutations fixed across Users (role/
enable/unlock), Integrations (webhook delete, key revoke), Alerts (rule toggle/
delete), Devices (credential delete); Devices + Alerts + Topology page tests
(frontend suite 46 → 61). Deliberately skipped: splitting configs.ts (382 lines,
17 cohesive routes - churn without payoff).

**External review round (2026-07-06):** notifier hardening (Teams/Slack via
`fetchWithRetry`); daily prune of pre-restore DB safety dumps (>7d); in-app DB
backup/restore finished on the Users page; device notes (migration 029) + alert
ack notes (migration 030) + resolve/delete confirmations + full automation-rule
editing (not just the enable toggle); front-panel port filter (name/desc/VLAN);
Devices search + status dropdown + sortable columns; SSH chaos tests
(enable-password prompt, echo-in-separate-chunk, --More-- pagination) +
auto-remediation off-by-default safety-gate test; Devices/Alerts page tests.
Deliberately NOT done: a full `refreshCiscoDevice` integration test (needs a
session-injection seam; `sshTargetFor` hard-codes port 22 — hot-path refactor,
out of scope for a test). Reviewer over-weighted easy wins and worked from a
partly-stale snapshot (claimed Compliance/Firmware had no tests; they did).

**Alerts UX (2026-07-06):** ack/resolve now refresh the bell badge immediately
(invalidate `/api/summary`) instead of lagging its 30s poll; the sidebar "Alerts"
badge and the bell share one open-alert count (`useOpenAlerts`) so they always
agree and both clear on ack — the divergent live-only counter is gone.

**RouterOS firmware relocated (2026-07-06):** moved off the device detail page
into a "RouterOS firmware (MikroTik)" section on the Firmware page (single home;
reusable `components/RouterOsFirmwarePanel`). When a device is too full to update
in place (`lowDiskForUpdate`), the futile Download button is hidden and the panel
explains that the device must be reflashed via Netinstall (a 16 MB-flash CRS326
can't hold the ~14 MB package; transferring from the platform doesn't help — the
`.npk` still has to fit on flash). RouterBOARD bootloader upgrade still applies.

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

**Commit-confirm armed indicator (2026-07-01):** while a safe-apply push is
inside its confirmation window, `pushConfigWithRevert` records the revert
deadline in a redis key whose TTL matches the timer (self-clearing, works
across replicas; cleared early on confirm). `GET /api/devices/:id` returns it
as `revert_armed_until` and the device page shows an amber "auto-revert armed
until HH:MM" badge, pushed live via `device_updated` events.

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

**External review triage (2026-07-02):** adopted two items - syslog viewer
storage now batches (util/batcher.ts: 1s interval or 200 rows, 5000-row memory
cap, failed flush drops instead of retry-storming; alert matching stays
immediate) and the web terminal gets a 15-minute idle timeout (client input
only; device output doesn't keep a dead tab alive). Rejected/already built:
NetFlow "line-by-line writes" (collector has aggregated per-minute buckets +
chunked batch inserts since day one), webhook payload signing (outbound-only +
HMAC-SHA256 X-SwitchPilot-Signature already implemented), credential-script
hardening (reveals are already audited; KMS is out of scope for self-hosted),
worker-thread telemetry + TimescaleDB (wrong scale; retention pruning already
caps growth), PortGrid virtualization (a front panel is a few hundred nodes,
not a list), and "per-frame WS crypto" (not a real practice; wss + nonce
handshake + DB-role check + audit is the standard model).

**Already covered (raised in reviews, but built):** sweep concurrency
(`CONCURRENCY=8` worker pool + per-device SSH pool), syslog retention (14-day),
HA (Postgres-advisory-lock leader election + `replicas: 2`), credentials-in-memory
(unavoidable), compliance config caching (regex over the stored backup). MM parity
already in SwitchPilot: 2FA/TOTP + backup codes, RBAC, AES-256-GCM credentials,
audit log, config backup + git history + diffs + rollback, drift/compliance,
maintenance windows, templates, global search, discovery, ring-based firmware
rollouts, endpoint search, capacity trends.
