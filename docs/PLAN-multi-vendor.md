# Plan: Multi-Vendor Support (MikroTik / RouterOS planned)

Status: directive in effect now; the driver seam is not built yet. Goal: keep
the codebase ready so adding a second vendor is incremental, not a rewrite.

## Where vendor (Cisco/IOS) assumptions live today

| Concern | File(s) | Coupling |
|---|---|---|
| SSH session (prompts, enable, paging) | `cisco/sshClient.ts` | IOS prompt regex, `enable`, `terminal length 0` |
| SSH pool | `cisco/sshPool.ts` | vendor-neutral already |
| Show-command parsing | `cisco/parsers.ts` | all IOS/IOS-XE/NX-OS `show` formats |
| Capability DB | `cisco/capabilities.ts` + `capabilities.json` | Cisco models, `os` = ios/iosxe/nxos |
| Model detection | `cisco/detector.ts` | parses `show version` |
| Lifecycle / OUI | `cisco/lifecycle.ts`, `cisco/oui.ts` | vendor-neutral (OUI is universal; lifecycle is Cisco model prefixes) |
| Full refresh sweep | `services/monitorService.ts` | hardcoded `show version/interfaces status/mac address-table/...`, NX-OS branches on `capabilities.os` |
| Device comms (exec/push/bounce/cable-test) | `services/deviceComms.ts` | `write memory` vs `copy run start`, `interface`/`shutdown` config |
| Firmware | `services/firmwareService.ts` | `copy http`, `verify /md5`, `boot system`, `reload` |
| Provisioning baseline | `services/provisionService.ts` | `lldp run`, `logging host`, `snmp-server community` |
| Port config | `routes/ports.ts` | `switchport`, `spanning-tree`, `power inline`, voice vlan |
| Compliance rules | migrations `006/012/015` seeds | IOS config-line/regex patterns |
| Syslog patterns | `services/syslogService.ts` | IOS/NX-OS `%FACILITY-SEV-MNEMONIC` regexes (RFC layer is generic) |
| Config guardrails | `routes/configs.ts` preview | IOS interface/`switchport`/`no vlan` syntax |

Vendor is currently implied by `capabilities.os` (`ios` | `iosxe` | `nxos`).
MikroTik adds `routeros`. The `vendor` is not a first-class column yet.

## The seam to introduce (when the work starts)

A per-vendor **DeviceDriver** interface that owns everything CLI/syntax-specific.
Sketch:

```ts
interface DeviceDriver {
  os: 'ios' | 'iosxe' | 'nxos' | 'routeros';
  connect(target): Promise<Session>;          // prompt/enable/paging differences
  // read
  commands: { version; interfaces; macTable; cdpLldp; vlans; env; cpuMem };
  parse: { version; interfaces; macTable; neighbors; vlans; env; cpuMem };
  // write
  setPortAccessVlan(port, vlan): string[];     // returns config lines
  setPortMode(...): string[]; bounce(port): string[]; saveConfig: string;
  baseline(opts): string[];                    // lldp/syslog/snmp equivalents
  firmware: { copy(url,file); verify(file,hash); setBoot(file); reload };
}
```

`cisco/` becomes one implementation; `routeros/` a sibling. Services call
`driverFor(device)` instead of hardcoding strings. monitorService's sweep
becomes "ask the driver for command+parser pairs and run them."

RouterOS specifics to remember: it's not IOS-like - commands are
`/interface/print`, `/ip/address/print`, etc., often with `detail` and a
script-friendly output; auth has no enable mode; firmware is package upload +
`/system/reboot`; syslog is configured via `/system/logging/action`. So the
driver abstraction (not "IOS dialect") is the right level.

## Interim rules (apply to every change now)

1. New OS-conditional logic switches on `capabilities.os` and treats Cisco as
   one case, not the assumption. Leave a `// vendor: cisco` marker at any new
   inline IOS command/syntax so the RouterOS branch point is findable.
2. Keep parsers pure and grouped by vendor dir.
3. Don't add new hardcoded IOS strings in routes - put config-line generation
   near the other port/baseline generators so it's easy to lift into a driver.
4. Compliance rules: tag vendor when we add a `vendor` column (CIS pack work is
   a good moment to introduce `compliance_rules.vendor`).
5. Onboarding/detection already branches on detected OS - extend `detector.ts`
   to recognize RouterOS rather than assuming Cisco.

## Ranked backlog

Lift: S ~= half-day, M ~= 1-2 days, L ~= multi-day. Order is the critical path;
earlier items gate later ones.

| # | Item | Lift | Status | Notes / depends on |
|---|---|---|---|---|
| 0 | `devices.vendor` column (default 'cisco'), surfaced in UI | S | DONE (migration 016) | Foundation - every vendor branch needs it |
| 1 | Extract `DeviceDriver` seam; wrap Cisco as `ciscoDriver` | L | DONE (write surface) | `backend/src/drivers/` owns skipEnable, saveCommand, port admin/config, bounce, cable test, logging trap, and now `baseline()`. deviceComms + ports + configs + provisionService route through `driverFor(device)`. Read-command orchestration in monitorService.refreshDevice is tracked separately as #4. |
| 1b | `routerosDriver` write surface | M | DONE (unverified vs hardware) | `drivers/routeros.ts` implements the interface in RouterOS syntax for the unambiguous ops (admin, bounce, logging, baseline: discovery/remote-logging/SNMP) and `driverFor` dispatches on vendor=mikrotik / os=routeros. portConfig + cableTest deliberately throw 501 (bridge-VLAN model + per-model TDR = #6) rather than emit unverified commands. Covered by `tests/driver.routeros.test.ts`. Needs a real box to confirm the strings land. |
| 2 | RouterOS SSH session | M | todo | No enable mode, different prompt, `/command/print`, different paging. Depends on #1. Needs hardware to validate. |
| 3 | RouterOS detection at onboarding | S-M | todo | `/system/resource/print` -> "RouterOS"; set vendor=mikrotik, os=routeros. Depends on #2. |
| 4 | RouterOS read parsers | M-L | todo | `/system/resource`, `/interface/print detail`, `/interface/bridge/vlan`, `/ip/neighbor`, switch/MAC tables. Key-value output, unlike IOS columns - the bulk of the work. Depends on #1-2. |
| 5 | RouterOS capability model | S-M | todo | Model entries for CRS3xx/CSS/hEX etc., port counts, PoE flags. |
| 6 | RouterOS port/VLAN config (write) | M | todo | Bridge-VLAN-filtering model differs from Cisco switchport. Depends on #1-4. |
| 7 | RouterOS provisioning baseline | S-M | todo | Map lldp/syslog/snmp to `/ip/neighbor/discovery`, `/system/logging`, `/snmp`. |
| 8 | RouterOS syslog patterns | S | todo | RFC PRI/storage already works; add RouterOS event-topic alert rules. |
| 9 | RouterOS firmware | M | todo | Package .npk upload + `/system/reboot`, not `copy http` + `verify /md5`. |
| 10 | Vendor-tagged compliance + RouterOS rule pack | M | todo | Add `compliance_rules.vendor`; best folded into the CIS-pack work to avoid a second migration. |
| 11 | Onboarding UX for vendor | S | todo | Vendor selector in the wizard; RouterOS admin account via `/user add` replaces the SPAdmin/`username` flow. |

Milestones:
- **Read-only MikroTik** = #1 + #2 + #3 + #4 + #5 (onboard and monitor a MikroTik).
- **Manage MikroTik** = #6 + #7 + #8 + #11.
- **Polish** = #10 + MikroTik lifecycle data.

OUI lookup is already vendor-neutral. Lifecycle data is Cisco-model-prefix
based; MikroTik lifecycle is optional/separate.

## Original first concrete steps (kept for reference)

1. Add `devices.vendor` (default 'cisco') + set `capabilities.os='routeros'`.
2. Extract the `DeviceDriver` interface; wrap current Cisco code as `ciscoDriver`.
3. Build `routerosDriver` (connect, a handful of `/print` parsers, port/vlan
   config, baseline, reboot).
4. Detection: RouterOS banner / `/system/resource/print`.
5. A RouterOS compliance rule pack + baseline.
