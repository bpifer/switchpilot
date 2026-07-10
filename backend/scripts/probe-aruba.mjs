#!/usr/bin/env node
// One-shot diagnostic: probes an Aruba Instant On via SNMPv2c and dumps
// exactly the data SwitchPilot's arubaMonitor will use. Run from the backend
// directory so net-snmp resolves:
//   node scripts/probe-aruba.mjs <host> <community>
// Example: node scripts/probe-aruba.mjs 192.168.1.50 public

import snmp from 'net-snmp';

const host = process.argv[2] ?? '192.168.1.50';
const community = process.argv[3] ?? 'public';

const OIDS = {
  sysDescr:  '1.3.6.1.2.1.1.1.0',
  sysName:   '1.3.6.1.2.1.1.5.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  // ENTITY-MIB: try chassis index .1 and .1000
  entModel1:    '1.3.6.1.2.1.47.1.1.1.1.13.1',
  entSerial1:   '1.3.6.1.2.1.47.1.1.1.1.11.1',
  entModel1000: '1.3.6.1.2.1.47.1.1.1.1.13.1000',
  entSerial1000:'1.3.6.1.2.1.47.1.1.1.1.11.1000',
};

// Subtrees to walk
const WALKS = {
  'IF-MIB ifType':        '1.3.6.1.2.1.2.2.1.3',
  'IF-MIB ifName':        '1.3.6.1.2.1.31.1.1.1.1',
  'IF-MIB ifHighSpeed':   '1.3.6.1.2.1.31.1.1.1.15',
  'IF-MIB ifAdminStatus': '1.3.6.1.2.1.2.2.1.7',
  'IF-MIB ifOperStatus':  '1.3.6.1.2.1.2.2.1.8',
  'ENTITY entPhysDesc':   '1.3.6.1.2.1.47.1.1.1.1.2',   // all physical entity descriptions
  'ENTITY entPhysClass':  '1.3.6.1.2.1.47.1.1.1.1.5',   // 3=chassis, 10=port
  'LLDP remSysName':      '1.0.8802.1.1.2.1.4.1.1.9',
  'LLDP remPortId':       '1.0.8802.1.1.2.1.4.1.1.7',
};

const sess = snmp.createSession(host, community, {
  version: snmp.Version2c,
  timeout: 5000,
  retries: 1,
});

function get(oids) {
  return new Promise((res, rej) =>
    sess.get(oids, (err, vbs) => err ? rej(err) : res(Object.fromEntries(vbs.map(v => [v.oid, v.value?.toString?.() ?? String(v.value)]))))
  );
}

function walk(base) {
  return new Promise((res, rej) => {
    const out = {};
    sess.subtree(base, 20, (vbs) => { for (const v of vbs) out[v.oid] = v.value?.toString?.() ?? String(v.value); },
      (err) => err ? rej(err) : res(out));
  });
}

async function main() {
  console.log(`\n=== Probing ${host} (community: ${community}) ===\n`);

  // System scalars
  console.log('--- System ---');
  try {
    const sys = await get(Object.values(OIDS));
    for (const [k, v] of Object.entries(OIDS)) {
      console.log(`  ${k.padEnd(14)}: ${sys[v] ?? '(no response)'}`);
    }
  } catch (e) {
    console.error('  GET failed:', e.message);
    console.error('  -> Check IP, community string, and that SNMP is enabled on the device.');
    sess.close(); process.exit(1);
  }

  // Subtree walks
  for (const [label, base] of Object.entries(WALKS)) {
    console.log(`\n--- ${label} (${base}) ---`);
    try {
      const rows = await walk(base);
      const entries = Object.entries(rows);
      if (entries.length === 0) { console.log('  (empty - MIB subtree not available)'); continue; }
      for (const [oid, val] of entries) {
        const suffix = oid.slice(base.length + 1);
        console.log(`  .${suffix.padEnd(20)}: ${val}`);
      }
    } catch (e) {
      console.log(`  (walk error: ${e.message})`);
    }
  }

  console.log('\n=== Done ===');
  sess.close();
}

main().catch(e => { console.error(e); sess.close(); process.exit(1); });
