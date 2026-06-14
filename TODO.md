# SwitchPilot TODO

Working checklist of outstanding work. Detail/architecture for the MikroTik
items lives in [docs/PLAN-multi-vendor.md](docs/PLAN-multi-vendor.md).

## Do next (MikroTik bring-up)

- [ ] **Deploy + onboard the CRS326 and validate end-to-end.** On the LXC:
      `cd /opt/switchpilot && git pull && docker compose up -d --build`, then
      onboard `192.168.10.41` (user `admin`, no enable password) via the UI.
      Confirm: identity (CRS326-24G-2S+, RouterOS 7.12.1), all 26 ports, the
      MAC-table endpoints, and CPU/temp populate. Paste any error to debug live.
- [ ] **#6 RouterOS port/VLAN write config.** `drivers/routeros.ts` `portConfig`
      currently throws 501. Implement access/trunk via bridge-VLAN filtering
      (bridge port `pvid`, tagged/untagged members, `vlan-filtering`). This is
      the bridge model, not Cisco switchport - validate against the CRS326.
- [ ] **#11 Onboarding wizard wording is Cisco-centric.** For a RouterOS device
      the wizard still references the SPAdmin/privilege-15 account and enable
      password. Functionally safe (backend ignores account creation for
      MikroTik), but the copy should adapt to vendor. `frontend/.../OnboardWizard.tsx`.

## MikroTik backlog (later)

- [ ] **#8 RouterOS syslog alert rules.** RFC syslog ingest already works; add
      RouterOS event-topic patterns so its log lines raise the right alerts.
- [ ] **#9 RouterOS firmware.** Package `.npk` upload + `/system/reboot`, not
      `copy http` + `verify /md5`. Driver firmware methods + UI.
- [ ] **#10 Vendor-tagged compliance + RouterOS rule pack.** `compliance_rules`
      already has a `vendor` column; add a RouterOS rule pack.
- [ ] Confirm the RouterOS **baseline apply** end-to-end (driver emits the
      commands; not yet run against the live box through a provisioning job).

## Smaller follow-ups

- [ ] PoE drill-down is in; consider a reverse link (device metrics -> PoE).
- [ ] `ICONS.poe` / `ICONS.locate` in `App.tsx` are now unused after the PoE
      merge and Locate fold-in; remove if tidying.
