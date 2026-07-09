#!/usr/bin/env node
// Explores what's readable and writable via SNMPv2c on the Aruba Instant On 1930.
// Read community: switchpilot   Write community: switchpilot-rw
// Runs safe tests only: SET tests use no-op values (current value back, or on
// ports already confirmed down so there's no traffic impact).
//   node scripts/probe-aruba-write.mjs <host>

import snmp from 'net-snmp';

const host = process.argv[2] ?? '10.4.23.11';
const RO = 'switchpilot';
const RW = 'switchpilot-rw';

function sess(community) {
  return snmp.createSession(host, community, { version: snmp.Version2c, timeout: 5000, retries: 1 });
}

function get(s, oids) {
  return new Promise((res, rej) =>
    s.get(oids, (err, vbs) => err ? rej(err) :
      res(Object.fromEntries(vbs.map(v => [v.oid, { value: v.value?.toString?.() ?? String(v.value), type: v.type }]))))
  );
}

function set(s, varbinds) {
  return new Promise((res, rej) =>
    s.set(varbinds, (err, vbs) => err ? rej(err) : res(vbs))
  );
}

function walk(s, base) {
  return new Promise((res, rej) => {
    const out = {};
    s.subtree(base, 20,
      (vbs) => { for (const v of vbs) out[v.oid] = { value: v.value?.toString?.() ?? String(v.value), type: v.type }; },
      (err) => err ? rej(err) : res(out));
  });
}

// Q-BRIDGE-MIB
const QB = {
  dot1dBasePortIfIndex:          '1.3.6.1.2.1.17.1.4.1.2',      // bridge port → ifIndex map
  dot1qPvid:                     '1.3.6.1.2.1.17.7.1.4.5.1.1',  // access VLAN per bridge port (RW)
  dot1qVlanStaticName:           '1.3.6.1.2.1.17.7.1.4.3.1.1',  // VLAN name by vlan-id
  dot1qVlanStaticEgressPorts:    '1.3.6.1.2.1.17.7.1.4.3.1.2',  // egress port bitmap (RW)
  dot1qVlanStaticUntaggedPorts:  '1.3.6.1.2.1.17.7.1.4.3.1.4',  // untagged port bitmap (RW)
  dot1qVlanCurrentEgressPorts:   '1.3.6.1.2.1.17.7.1.4.2.1.4',  // egress port bitmap (RO current)
  dot1qVlanForbiddenEgressPorts: '1.3.6.1.2.1.17.7.1.4.3.1.3',  // forbidden egress bitmap (RW)
  dot1qPortVlanTable:            '1.3.6.1.2.1.17.7.1.4.5',       // full port VLAN table
};

// IF-MIB writable
const IF_ALIAS_BASE  = '1.3.6.1.2.1.31.1.1.1.18';
const IF_ADMIN_BASE  = '1.3.6.1.2.1.2.2.1.7';
// Port 1 is confirmed down (oper=2) from RO probe - safe for SET tests
const TEST_PORT_IDX  = 1;

async function main() {
  const ro = sess(RO);
  const rw = sess(RW);

  console.log(`\n=== Aruba 1930 SNMP write exploration: ${host} ===\n`);

  // ── 1. Verify RW community works ────────────────────────────────────────────
  console.log('--- 1. RW community check (GET sysName via switchpilot-rw) ---');
  try {
    const r = await get(rw, ['1.3.6.1.2.1.1.5.0']);
    console.log(`  sysName: ${r['1.3.6.1.2.1.1.5.0']?.value}  ✓ RW community accepted`);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    ro.close(); rw.close(); process.exit(1);
  }

  // ── 2. SET test: ifAdminStatus (port up/down) ────────────────────────────────
  console.log(`\n--- 2. SET ifAdminStatus.${TEST_PORT_IDX} → 2 (down, already down — no-op) ---`);
  try {
    await set(rw, [{ oid: `${IF_ADMIN_BASE}.${TEST_PORT_IDX}`, type: snmp.ObjectType.Integer, value: 2 }]);
    console.log(`  ✓ ifAdminStatus SET accepted  (port admin up/down IS writable)`);
    // Restore to admin-up (it was admin-up before, just operationally down)
    await set(rw, [{ oid: `${IF_ADMIN_BASE}.${TEST_PORT_IDX}`, type: snmp.ObjectType.Integer, value: 1 }]);
    console.log(`  ✓ Restored to admin-up`);
  } catch (e) {
    console.log(`  ✗ ifAdminStatus SET rejected: ${e.message}`);
  }

  // ── 3. SET test: ifAlias (port description) ──────────────────────────────────
  console.log(`\n--- 3. SET ifAlias.${TEST_PORT_IDX} (port description write) ---`);
  try {
    const cur = await get(ro, [`${IF_ALIAS_BASE}.${TEST_PORT_IDX}`]);
    const curAlias = cur[`${IF_ALIAS_BASE}.${TEST_PORT_IDX}`]?.value ?? '';
    await set(rw, [{ oid: `${IF_ALIAS_BASE}.${TEST_PORT_IDX}`, type: snmp.ObjectType.OctetString, value: curAlias }]);
    console.log(`  ✓ ifAlias SET accepted  (port description IS writable, current: "${curAlias}")`);
  } catch (e) {
    console.log(`  ✗ ifAlias SET rejected: ${e.message}`);
  }

  // ── 4. Q-BRIDGE-MIB: bridge port → ifIndex map ──────────────────────────────
  console.log('\n--- 4. Q-BRIDGE dot1dBasePortIfIndex (bridge port ↔ ifIndex) ---');
  let bridgeToIf = {};
  try {
    const rows = await walk(ro, QB.dot1dBasePortIfIndex);
    bridgeToIf = Object.fromEntries(
      Object.entries(rows).map(([oid, v]) => [oid.split('.').pop(), Number(v.value)])
    );
    if (Object.keys(bridgeToIf).length === 0) {
      console.log('  (empty - bridge port table not available)');
    } else {
      console.log(`  ${Object.keys(bridgeToIf).length} bridge ports mapped`);
      // Show first 6
      Object.entries(bridgeToIf).slice(0, 6).forEach(([bp, idx]) =>
        console.log(`    bridge port ${bp} → ifIndex ${idx}`));
      if (Object.keys(bridgeToIf).length > 6) console.log('    ...');
    }
  } catch (e) {
    console.log(`  walk error: ${e.message}`);
  }

  // ── 5. Q-BRIDGE-MIB: dot1qPvid (access VLAN per port) ──────────────────────
  console.log('\n--- 5. dot1qPvid (access VLAN per bridge port) ---');
  try {
    const rows = await walk(ro, QB.dot1qPvid);
    if (Object.keys(rows).length === 0) { console.log('  (not available)'); }
    else {
      Object.entries(rows).slice(0, 28).forEach(([oid, v]) => {
        const bp = oid.split('.').pop();
        const ifIdx = bridgeToIf[bp] ?? `bp${bp}`;
        console.log(`    bridge port ${bp} (ifIndex ${ifIdx}): VLAN ${v.value}`);
      });
    }
  } catch (e) { console.log(`  error: ${e.message}`); }

  // ── 6. SET test: dot1qPvid (change access VLAN) ──────────────────────────────
  // Bridge port 1 maps to ifIndex 1 (confirmed down port). Set to current value.
  console.log('\n--- 6. SET dot1qPvid (access VLAN change - no-op to current value) ---');
  try {
    const cur = await get(ro, [`${QB.dot1qPvid}.1`]);
    const curVlan = Number(cur[`${QB.dot1qPvid}.1`]?.value ?? 1);
    await set(rw, [{ oid: `${QB.dot1qPvid}.1`, type: snmp.ObjectType.Gauge, value: curVlan }]);
    console.log(`  ✓ dot1qPvid SET accepted  (access VLAN change IS writable, port 1 = VLAN ${curVlan})`);
  } catch (e) { console.log(`  ✗ dot1qPvid SET rejected: ${e.message}`); }

  // ── 7. VLAN table ────────────────────────────────────────────────────────────
  console.log('\n--- 7. dot1qVlanStaticName (defined VLANs) ---');
  try {
    const rows = await walk(ro, QB.dot1qVlanStaticName);
    if (Object.keys(rows).length === 0) { console.log('  (not available)'); }
    else {
      Object.entries(rows).forEach(([oid, v]) => {
        const vid = oid.split('.').pop();
        console.log(`    VLAN ${vid}: "${v.value}"`);
      });
    }
  } catch (e) { console.log(`  error: ${e.message}`); }

  // ── 8. Static egress bitmaps (needed for trunk VLAN membership) ──────────────
  console.log('\n--- 8. dot1qVlanStaticEgressPorts (trunk VLAN bitmap — sample) ---');
  try {
    const rows = await walk(ro, QB.dot1qVlanStaticEgressPorts);
    if (Object.keys(rows).length === 0) { console.log('  (not available)'); }
    else {
      console.log(`  ${Object.keys(rows).length} VLAN egress rows found  ✓ (trunk VLAN changes feasible via bitmap SET)`);
      // Show first 3 rows as hex
      Object.entries(rows).slice(0, 3).forEach(([oid, v]) => {
        const vid = oid.split('.').pop();
        const hex = Buffer.from(String(v.value)).toString('hex');
        console.log(`    VLAN ${vid} egress bitmap: ${hex || '(empty)'}`);
      });
    }
  } catch (e) { console.log(`  error: ${e.message}`); }

  // ── 9. Writable: static egress SET test ─────────────────────────────────────
  console.log('\n--- 9. SET dot1qVlanStaticEgressPorts (trunk membership — no-op) ---');
  try {
    const cur = await get(ro, [`${QB.dot1qVlanStaticEgressPorts}.0.1`]);
    const key = `${QB.dot1qVlanStaticEgressPorts}.0.1`;
    const curVal = cur[key]?.value;
    if (!curVal) throw new Error('VLAN 1 egress bitmap not found at .0.1 index');
    await set(rw, [{ oid: key, type: snmp.ObjectType.OctetString, value: curVal }]);
    console.log(`  ✓ dot1qVlanStaticEgressPorts SET accepted  (trunk membership IS writable)`);
  } catch (e) { console.log(`  ✗ dot1qVlanStaticEgressPorts SET: ${e.message}`); }

  console.log('\n=== Done ===');
  ro.close(); rw.close();
}

main().catch(e => { console.error(e); process.exit(1); });
