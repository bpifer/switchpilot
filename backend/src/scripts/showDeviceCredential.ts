// Recover the plaintext SSH login SwitchPilot stores for a device, by decrypting
// the credential vault with the running CREDENTIAL_KEY. This is an owner
// break-glass / recovery tool: it needs the same master key the app already uses,
// so it exposes nothing a key-holder couldn't decrypt anyway (the key, not this
// script, is the protection). Prints secrets to stdout - run it in a private shell.
//
// Run where the DB is reachable and CREDENTIAL_KEY is set (e.g. inside the api
// container, which has both):
//   docker compose exec api npm run show-credential -- 192.168.1.20
//   docker compose exec api npm run show-credential -- core-switch
// Matches on mgmt IP (exact) or hostname (case-insensitive substring). With no
// argument, lists the devices that have a credential attached.
import { pool } from '../db.js';
import { decryptSecret } from '../crypto/secrets.js';
import { audit } from '../audit.js';

async function main(): Promise<void> {
  const needle = process.argv[2]?.trim();
  try {
    if (!needle) {
      const { rows } = await pool.query(
        `SELECT host(d.mgmt_ip) AS ip, d.hostname, c.name AS credential
           FROM devices d JOIN credentials c ON c.id = d.credential_id
          ORDER BY d.hostname, ip`);
      if (!rows.length) { console.log('No devices have a credential attached.'); return; }
      console.log('Pass a device IP or hostname. Devices with a stored credential:');
      for (const r of rows) console.log(`  ${String(r.ip).padEnd(16)} ${r.hostname || '(no hostname)'}  [${r.credential}]`);
      return;
    }

    const { rows } = await pool.query(
      `SELECT d.id, host(d.mgmt_ip) AS ip, d.hostname, c.name AS credential,
              c.ssh_username, c.ssh_password_enc, c.enable_password_enc,
              c.snmp_version, c.snmp_community_enc
         FROM devices d JOIN credentials c ON c.id = d.credential_id
        WHERE host(d.mgmt_ip) = $1 OR d.hostname ILIKE '%' || $1 || '%'
        ORDER BY d.hostname, ip`,
      [needle]);

    if (!rows.length) {
      console.error(`No device matched "${needle}". Try the exact mgmt IP or part of the hostname (run with no argument to list).`);
      process.exitCode = 1;
      return;
    }

    const dec = (v: string) => { try { return decryptSecret(v); } catch { return '<decrypt failed - wrong CREDENTIAL_KEY?>'; } };
    for (const r of rows) {
      console.log('');
      console.log(`Device   : ${r.hostname || '(no hostname)'}  (${r.ip})`);
      console.log(`Profile  : ${r.credential}`);
      console.log(`Username : ${r.ssh_username || '(none)'}`);
      console.log(`Password : ${r.ssh_password_enc ? dec(r.ssh_password_enc) : '(none stored)'}`);
      if (r.enable_password_enc) console.log(`Enable   : ${dec(r.enable_password_enc)}`);
      if (r.snmp_community_enc) console.log(`SNMP (${r.snmp_version}) community : ${dec(r.snmp_community_enc)}`);
    }
    console.log('');

    // Leave a paper trail in the hash-chained audit log of who pulled a plaintext
    // credential and when. Exec access can bypass this, but a normal run records
    // it; audit() swallows its own errors, so it never suppresses the output above.
    // Set AUDIT_ACTOR=<name> to attribute the run to a person.
    const actor = process.env.AUDIT_ACTOR || process.env.USER || 'break-glass-cli';
    for (const r of rows) {
      await audit(actor, 'credential.reveal', r.id,
        { device: r.hostname || r.ip, via: 'show-credential' }, 'cli');
    }
    console.error(`(recorded ${rows.length} credential reveal(s) in the audit log as "${actor}")`);
  } finally {
    await pool.end();
  }
}

void main();
