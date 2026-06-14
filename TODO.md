# SwitchPilot TODO

Working checklist of outstanding work. Detail/architecture for the MikroTik
items lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## Do next (MikroTik bring-up)

- [ ] **Deploy + onboard the CRS326 and validate end-to-end.** On the LXC:
      `cd /opt/switchpilot && git pull && docker compose up -d --build`, then
      onboard `192.168.10.41` (user `admin`, no enable password) via the UI.
      Confirm: identity (CRS326-24G-2S+, RouterOS 7.12.1), all 26 ports, the
      MAC-table endpoints, and CPU/temp populate. Paste any error to debug live.
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
- [ ] Confirm the RouterOS **baseline apply** end-to-end (driver emits the
      commands; not yet run against the live box through a provisioning job).

## Smaller follow-ups

- [ ] PoE drill-down is in; consider a reverse link (device metrics -> PoE).
