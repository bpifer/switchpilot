# SwitchPilot TODO

Working checklist of outstanding work. Detail/architecture for the MikroTik
items lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## Do next (MikroTik bring-up)

- [x] **Deploy + onboard the CRS326 and validate end-to-end.** DONE 2026-06-14.
      Deployed to the LXC (migrations 020/021 applied), onboarded 192.168.10.41
      via the real API: vendor=mikrotik, 26 ports, 14 clients (OUI-resolved),
      cpu/mem/temp populated, on-demand refresh 200. Vendor-aware `/export
      hide-sensitive` backup + compliance both work (MikroTik 5/6, Cisco 15/15).
      Caught + fixed a cross-vendor leak in the per-device compliance view.
      Still untested: the baseline provisioning JOB path (onboarded with
      applyBaseline=false since the baseline was already applied directly).
- [x] **#6 RouterOS port/VLAN write config.** DONE - `drivers/routeros.ts`
      `portConfig` emits idempotent bridge-VLAN scripts (access + trunk, pvid +
      tagged/untagged membership, derives the bridge from the port). Validated
      end-to-end on the CRS326 (ether1) and reverted. Caveat below.
- [x] **Surface the vlan-filtering caveat in the UI.** DONE - the port-config
      response carries a `warning` when a VLAN is set on a RouterOS port whose
      bridge has `vlan-filtering=off`; PortsTab shows it. (`bridgeVlanFiltering`
      in routerosMonitor, wired through routes/ports.ts.)
- [x] **#11 Onboarding wizard wording.** DONE - OnboardWizard adapts to the
      analyze `vendor`: RouterOS drops the SPAdmin/account flow and account list.

## MikroTik backlog (later)

- [x] **#8 RouterOS syslog alert rules.** DONE - "etherN link down" fires the
      port_down automation (parity with Cisco %LINEPROTO-UPDOWN). More RouterOS
      event patterns can be added as observed.
- [ ] **#9 RouterOS firmware.** Package `.npk` upload + `/system/reboot`, not
      `copy http` + `verify /md5`. Driver firmware methods + UI. (Higher risk -
      reboots the switch; build + unit-test, do not auto-reboot.)
- [x] **#10 Vendor-tagged compliance + RouterOS rule pack.** DONE - compliance
      filters by vendor; migration 020 adds a RouterOS hardening pack; config
      backup uses `/export hide-sensitive`. Validated on the CRS326.
- [x] Confirm the RouterOS **baseline apply** end-to-end. DONE - ran
      `POST /api/devices/:id/provision` on the deployed platform; the config_push
      job completed (queue -> worker -> push) and applied discovery + per-topic
      logging rules. Syslog now flows: info + warning messages arrive and are
      attributed to the device on the Logs page.

## Smaller follow-ups

- [x] **RouterOS syslog severity.** DONE - baseline action now sets
      bsd-syslog=yes; RouterOS sends an RFC3164 <PRI> and the platform parses
      severity/facility (verified: severity=4/warning on the CRS326).
- [x] **RouterOS per-port live MAC + bridge-VLAN list.** DONE - GET
      /ports/:port/macs and /devices/:id/vlans are vendor-aware (bridge host
      table per interface; `/interface bridge vlan`). Verified on the CRS326.
- [x] **Front panel renders RouterOS + speed colors.** DONE - PortGrid handled
      only Cisco slash names (MikroTik panel was empty); now renders ether*/sfp*
      and colors connected ports by link speed: 10G+ blue, 1G green, 10/100
      orange. (User-requested.)
- [ ] **RouterOS config restore/rollback via `/import`.** Currently blocked
      (a /export is not replayable line-by-line). Proper support = upload the
      backup to the device + `/import`, or `/system reset` + paste. Backups/diff/
      git history already work for RouterOS; only restore is blocked.
- [x] PoE reverse link (device metrics -> PoE). DONE - the Analytics "PoE usage"
      chart links to the fleet PoE budget view, mirroring the existing
      budget -> device drill-down.

## Homelabber feature roadmap

Built this session (validated live where hardware allowed):
- [x] **Prometheus exporter** for Grafana - per-device + per-port gauges
      (`/metrics`), labelled by device/port/vendor/site.
- [x] **MQTT + Home Assistant** (`services/mqttService.ts`). Set `MQTT_URL`
      (+ `MQTT_USERNAME`/`MQTT_PASSWORD`, optional `MQTT_BASE_TOPIC`,
      `MQTT_HA_PREFIX`, `MQTT_HA_DISCOVERY`) in the api env to activate. Publishes
      HA-discovered device entities; commands: `<base>/cmd/port` {deviceId,port,
      action: enable|disable|poe-cycle}, `<base>/cmd/wol` {mac}.
- [x] **SFP/DDM optics** - `GET /ports/:port/sfp` + port-detail panel. Validated
      "no module"; insert a 10G SFP+ to confirm Tx/Rx power readings.
- [x] **PoE power-cycle + Wake-on-LAN** - port PoE-cycle button + a Wake button
      per endpoint. WoL validated live; PoE-cycle needs PoE-capable hardware to
      confirm end to end.

Still on the wishlist (ranked):
- [~] **UniFi driver** - DECLINED (2026-06-14): UniFi has its own controller
      dashboard, so it is not worth the effort. Other SSH-managed vendors
      (Aruba/HPE, Netgear, Brocade/ICX) are still candidates via the driver seam.
- [x] **More notification channels** DONE (PR #7, `ba9ac57`): Discord, ntfy,
      Gotify, Telegram, Pushover added alongside Teams/Slack/SMTP.
- [ ] **GitOps / intent-based config**: declare desired VLANs/port profiles in
      YAML, reconcile + flag drift (compliance/drift engine + git history exist).
- [x] **Config-history external git mirror (DR).** DONE - `CONFIG_HISTORY_REMOTE`
      pushes the config-history repo to a dedicated remote after each nightly
      backup sweep (`pushMirror` in configVersioning; best-effort, fails fast on a
      bad remote, redacts credentials from logs).
- [ ] **PoE energy + cost**: watts over time -> kWh -> dollar figure (rate cfg).
- [ ] **Richer auto-topology map**: link utilization, VLAN overlays, "what's
      plugged into what" from the neighbor/client data.
- [ ] **DHCP/IPAM correlation** (pull leases from MikroTik/pfSense/Pi-hole).
- [x] **Installable PWA (phone/rack use).** DONE - web manifest + service worker
      (offline app shell, network-first, never caches `/api`), a PNG + maskable
      icon set, registered in production builds only.

## Change management & trust (from external review, valid items)

Ranked; the "biggest trust" gaps are at the top.
- [x] **SSH host-key verification.** DONE (PR #3, `7f3a387`/`d24e5be`) - TOFU
      pin on first onboard, refuse a changed key before auth, device-page UI to
      view/re-pin.
- [ ] **Transactional / commit-confirm pushes.** `configure()` aborts mid-push
      on `% Invalid` but does NOT roll back already-applied lines, and there is
      no "apply -> verify reachability -> auto-revert if the session drops."
      Pre-change backups exist, but add IOS `reload in` + confirm (or
      `configure replace`). Biggest trust multiplier.
- [x] **Post-change read-back validation.** DONE (PR #5, `ffcf67a`) -
      `services/portVerify.ts` re-reads the port after an edit.
- [x] **Preview/diff on structured edits.** DONE (PR #4, `00fa171`) -
      `services/configPreview.ts`; the Ports-tab flow now previews before apply.
- [ ] **Visual rack view** (U layout of devices). Pure frontend; homelab-loved.
- [ ] **Dry-run remediation + compliance-rule auto-remediation.** Drift already
      auto-remediates vs a pinned baseline; add a dry-run mode and optional
      scheduled remediation for compliance rules.
- [x] **Fleet health score** DONE (PR #6, `454f8a4`) - `services/fleetHealth.ts`
      composite (online% + compliance% + open-criticals) on the dashboard.
- [ ] **Unified per-device timeline** - stitch the audit log, alerts, git config
      history, and jobs into one chronological feed (data all exists).
- [ ] **Golden config inheritance** - templates + baseline + drift cover most of
      this; add a hierarchy/inheritance model.
- [ ] Niche / high-effort: 802.1X user tracking for endpoints, offline config
      "digital twin" simulation, AI-assisted config analysis (why non-compliant /
      what changed / what broke).

Already covered (raised in the review but built): ring-based firmware rollouts
(canary->fleet), MAC/IP/hostname/VLAN endpoint search, cpu/mem/temp/PoE/port-bw
capacity trends.

## Architecture, security & DR (external review #2, valid items)

Difficulty: **Easy** ~half day, **Medium** 1-2 days, **Hard** multi-day / risky.
Ranked by value-per-effort.

- [x] **Optional `/metrics` auth.** `Easy`. DONE - `METRICS_TOKEN` env gates
      `GET /metrics` (`Authorization: Bearer <token>` or `?token=`, timing-safe
      compare); unset keeps it open.
- [x] **Show the host-key fingerprint at onboarding.** `Easy`. DONE - the
      analyze step captures and returns the SHA256 host-key fingerprint; the
      wizard shows it with a "verify before it is pinned" note.
- [x] **Document a DR / upgrade-rollback process.** `Easy`. DONE -
      `docs/DISASTER-RECOVERY.md` (backup/restore of the DB + volumes + `.env`,
      forward-only migrations, snapshot-based rollback, CREDENTIAL_KEY warning).
- [ ] **Capture command output in the audit log.** `Medium`. Config push +
      firmware currently audit `{ lines }` (commands) but not device output.
      Store the output (size-capped, secret-redacted) and show it on the audit
      timeline for high-trust ops.
- [ ] **Platform backup/restore workflow.** `Medium`. A "download a config
      bundle" + DB export/import path (or a documented `pg_dump`/restore + the
      git config repo), so the whole instance is recoverable, not just per-switch
      configs.
- [ ] **Secrets (CREDENTIAL_KEY) rotation.** `Medium`. A routine that re-encrypts
      all stored credentials/MFA secrets from an old key to a new one, with key
      versioning so rotation is non-destructive.
- [ ] **SNMP trap receiver (event-driven, not just polling).** `Medium`. Syslog
      ingest is already first-class; add a UDP/162 trap listener that maps common
      traps (linkUp/Down, etc.) to alerts, like the syslog path.
- [ ] **Reads through the driver + split `monitorService`.** `Hard`. The write
      surface is driver-abstracted, but Cisco reads (`show ...`) are inline in
      `monitorService.refreshDevice` while RouterOS uses `routerosMonitor`. Add
      `driver.readCommands`/parser pairs (or `getPorts/getVlans/getNeighbors`) and
      extract a `ciscoMonitor.ts` mirroring `routerosMonitor.ts`, so the refresh
      loop is "ask the driver for command+parser pairs and run them." This is
      backlog #4 in PLAN-multi-vendor and the real remaining Cisco coupling.
      `monitorService` (280 lines) is the one genuinely oversized service; the
      others (`complianceService` 130, `provisionService` 61) are fine, and the
      code already extracts focused modules (`configPreview`, `portVerify`,
      `fleetHealth`, `notifiers`).

Raised in the review but already covered: sweep concurrency (`scheduler.ts`
`CONCURRENCY=8` worker pool + per-device SSH pool), syslog retention (14-day
purge), HA (Postgres-advisory-lock leader election + `replicas: 2`),
credentials-in-memory (unavoidable, acknowledged), compliance config caching
(regex over the stored backup, not a heavy live parse).

## Cross-tool review: mikrotik-manager (external review #3, valid items)

Compared SwitchPilot against `2GT-Media-Group-LLC/mikrotik-manager` (AGPLv3,
MikroTik-only, same Node/React/Postgres/Redis stack). Same difficulty legend as
above. NOTE: that project is AGPLv3 - reimplement from behavior/standards, do
NOT copy source. Ranked by value-per-effort.

- [x] **Device Tools tab.** `Medium`. DONE - a device-detail Tools tab runs
      ping + traceroute (both vendors) and ip-scan (RouterOS) behind the driver
      seam (`driver.tools`/`toolCommand`, `runDeviceTool`). Targets are charset-
      validated at the route and re-guarded in the driver (injection-safe);
      continuous RouterOS traceroute is time-bounded via
      `RouterOsSshSession.execBounded`. Helpdesk+ to run, audited.
- [ ] **Device Tools: packet capture + bandwidth test.** `Hard`. Deferred from
      the initial tab: packet capture needs binary `.pcap` retrieval off the
      device (MikroTik `/tool sniffer` to file + fetch, Cisco `monitor capture` +
      export) and bandwidth test is intrusive (needs a target/server).
- [x] **NetFlow/IPFIX traffic analytics.** `Hard`. DONE (v5/v9) - a UDP collector
      (`NETFLOW_ENABLED`, udp/2055) decodes NetFlow v5 + v9, attributes each
      exporter to a device, classifies the app by port, and aggregates into
      `flow_records` (migration 024) flushed every 60s, pruned by
      `NETFLOW_RETAIN_DAYS`. A Traffic page shows over-time bytes, top talkers,
      and app breakdown (`/api/traffic/*`). Decoders are spec-derived (clean-room,
      not copied) and unit-tested with synthetic packets. Deferred below: IPFIX,
      auto-export-config, live validation against a real exporter.
- [ ] **NetFlow follow-ups.** `Medium`. Add IPFIX (v10) decode (close to v9), a
      driver helper to auto-configure flow export on a device (MikroTik `/ip
      traffic-flow` target, Cisco flow record/exporter/monitor) instead of manual
      setup, and validate end-to-end against the CRS326 (traffic-flow v5/v9).
- [ ] **Topology upgrades.** `Medium`. Add manual link drawing + persistence,
      orphan-node detection, and MNDP dedup on top of the existing CDP/LLDP
      auto-graph (`routes/topology.ts`). Complements the "richer auto-topology
      map" wishlist item above.
- [ ] **Self-lockout guard for writes.** Folds into **Transactional /
      commit-confirm pushes** (the #1 trust gap). Their `firewallSafety` idea:
      before applying a change, detect if it would drop the platform's own mgmt
      session (disabling the uplink/mgmt port, an ACL line, a mgmt-path VLAN
      change) and refuse or stage it behind `reload in` + auto-revert. Not a
      standalone item; design it into commit-confirm.
- [ ] **Per-device availability % (30-day).** `Easy`/`Medium`. SP has a fleet
      health score (online %); add per-device availability history/% over a
      window (MM tracks 30-day per-device uptime).
- [ ] **Credential presets (reusable, admin-restricted).** `Medium`. Reusable
      credential sets to speed onboarding / bulk-add, with presets restricted to
      admins. SP already has discovery + per-device credentials; this is the
      reuse/bulk layer on top.
- [ ] **Cert / SSL-expiry alert.** `Easy`. Where SP tracks a device or platform
      cert, alert ahead of expiry (MM has this as an alert type).

MM parity, already in SP (no action): 2FA/TOTP + backup codes, RBAC,
AES-256-GCM credentials, audit log, config backup + git history + line diffs +
rollback, drift/compliance, maintenance windows, templates, global search,
syslog, discovery, WoL, PoE, the full notification set, and a base CDP/LLDP
topology.

Reviewed but deliberately skipped (router-centric; would deepen single-vendor
assumptions and leave the multi-vendor switch focus): firewall / Security Center
rule builder + NAT + address lists, WireGuard VPN, DHCP/DNS/NTP config pages,
queues/QoS, and wireless SSID/CAPsMAN management. The one vendor-neutral slice
worth keeping (read-only DHCP/IPAM correlation) is already on the roadmap above.

## Cisco-coupling audited (done this session)

Hunted hardcoded `show`/IOS paths that would break RouterOS; all now
vendor-aware via the driver seam: config view/diff/preview (`configCommand`),
automation `disable_port` (`setPortAdmin`), per-port MACs + VLAN list, syslog
baseline (per-topic rules + bsd-syslog), and the mgmt_ip `host()` fixes.
Remaining Cisco-only spots are intentionally guarded (restore/rollback) or
vendor-tagged (enable-secret remediation is a cisco-only rule).
