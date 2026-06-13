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

## First concrete steps when MikroTik work begins

1. Add `devices.vendor` (default 'cisco') + set `capabilities.os='routeros'`.
2. Extract the `DeviceDriver` interface; wrap current Cisco code as `ciscoDriver`.
3. Build `routerosDriver` (connect, a handful of `/print` parsers, port/vlan
   config, baseline, reboot).
4. Detection: RouterOS banner / `/system/resource/print`.
5. A RouterOS compliance rule pack + baseline.
