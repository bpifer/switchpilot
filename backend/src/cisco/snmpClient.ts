import snmp from 'net-snmp';

export interface SnmpTarget {
  host: string;
  version: '2c' | '3';
  community?: string;
  v3?: {
    user: string;
    authProtocol: 'sha' | 'md5';
    authKey: string;
    privProtocol: 'aes' | 'des';
    privKey: string;
  };
}

export const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  // ENTITY-MIB
  entPhysicalModelName: '1.3.6.1.2.1.47.1.1.1.1.13',
  entPhysicalSerialNum: '1.3.6.1.2.1.47.1.1.1.1.11',
  entPhysicalClass: '1.3.6.1.2.1.47.1.1.1.1.5',    // 3=chassis; walk to find chassis index
  // CISCO-PROCESS-MIB cpmCPUTotal5minRev
  cpu5min: '1.3.6.1.4.1.9.9.109.1.1.1.1.8',
  // CISCO-MEMORY-POOL-MIB
  memUsed: '1.3.6.1.4.1.9.9.48.1.1.1.5.1',
  memFree: '1.3.6.1.4.1.9.9.48.1.1.1.6.1',
  // CISCO-ENVMON-MIB
  envTemp: '1.3.6.1.4.1.9.9.13.1.3.1.3',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifDescr: '1.3.6.1.2.1.2.2.1.2'
} as const;

function createSession(t: SnmpTarget): any {
  if (t.version === '3') {
    const v3 = t.v3!;
    return snmp.createV3Session(t.host, {
      name: v3.user,
      level: snmp.SecurityLevel.authPriv,
      authProtocol: v3.authProtocol === 'sha' ? snmp.AuthProtocols.sha : snmp.AuthProtocols.md5,
      authKey: v3.authKey,
      privProtocol: v3.privProtocol === 'aes' ? snmp.PrivProtocols.aes : snmp.PrivProtocols.des,
      privKey: v3.privKey
    }, { timeout: 5000, retries: 1 });
  }
  return snmp.createSession(t.host, t.community ?? 'public', {
    version: snmp.Version2c, timeout: 5000, retries: 1
  });
}

export function snmpGet(target: SnmpTarget, oids: string[]): Promise<Record<string, string | number>> {
  return new Promise((resolve, reject) => {
    const session = createSession(target);
    session.get(oids, (error: Error | null, varbinds: any[]) => {
      session.close();
      if (error) return reject(error);
      const out: Record<string, string | number> = {};
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        out[vb.oid] = Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : vb.value;
      }
      resolve(out);
    });
  });
}

/** Walk a subtree; returns { oid: value }. */
export function snmpWalk(target: SnmpTarget, baseOid: string): Promise<Record<string, string | number>> {
  return new Promise((resolve, reject) => {
    const session = createSession(target);
    const out: Record<string, string | number> = {};
    session.subtree(
      baseOid,
      (varbinds: any[]) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          out[vb.oid] = Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : vb.value;
        }
      },
      (error: Error | null) => {
        session.close();
        error ? reject(error) : resolve(out);
      }
    );
  });
}

/** Quick reachability + identity probe used by status polling and auto-detection. */
export async function snmpProbe(target: SnmpTarget): Promise<{
  sysName: string; sysDescr: string; uptimeSeconds: number;
} | null> {
  try {
    const res = await snmpGet(target, [OIDS.sysName, OIDS.sysDescr, OIDS.sysUpTime]);
    return {
      sysName: String(res[OIDS.sysName] ?? ''),
      sysDescr: String(res[OIDS.sysDescr] ?? ''),
      uptimeSeconds: Math.floor(Number(res[OIDS.sysUpTime] ?? 0) / 100)
    };
  } catch {
    return null;
  }
}
