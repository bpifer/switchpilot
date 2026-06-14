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
- [ ] PoE drill-down is in; consider a reverse link (device metrics -> PoE).

## Cisco-coupling audited (done this session)

Hunted hardcoded `show`/IOS paths that would break RouterOS; all now
vendor-aware via the driver seam: config view/diff/preview (`configCommand`),
automation `disable_port` (`setPortAdmin`), per-port MACs + VLAN list, syslog
baseline (per-topic rules + bsd-syslog), and the mgmt_ip `host()` fixes.
Remaining Cisco-only spots are intentionally guarded (restore/rollback) or
vendor-tagged (enable-secret remediation is a cisco-only rule).
