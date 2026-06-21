import { describe, it, expect } from 'vitest';
import { decodeNetflow, type TemplateCache } from '../src/services/netflow/decode.js';
import { appFor } from '../src/services/netflow/apps.js';

// ---- helpers: build synthetic NetFlow datagrams ----------------------------
function writeIp(b: Buffer, off: number, ip: string): void {
  ip.split('.').forEach((o, i) => { b[off + i] = Number(o); });
}

function v5Record(src: string, dst: string, pkts: number, octets: number, sport: number, dport: number, proto: number): Buffer {
  const b = Buffer.alloc(48);
  writeIp(b, 0, src);
  writeIp(b, 4, dst);
  b.writeUInt32BE(pkts, 16);
  b.writeUInt32BE(octets, 20);
  b.writeUInt16BE(sport, 32);
  b.writeUInt16BE(dport, 34);
  b[38] = proto;
  return b;
}
function v5Packet(records: Buffer[]): Buffer {
  const h = Buffer.alloc(24);
  h.writeUInt16BE(5, 0);
  h.writeUInt16BE(records.length, 2);
  return Buffer.concat([h, ...records]);
}

function v9Header(recordCount: number, sourceId = 1): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(9, 0);
  b.writeUInt16BE(recordCount, 2);
  b.writeUInt32BE(sourceId, 16);
  return b;
}
// Template id 256 with the 7 fields our decoder extracts, in record order.
function v9TemplateFlowset(): Buffer {
  const fields = [[8, 4], [12, 4], [7, 2], [11, 2], [4, 1], [1, 4], [2, 4]];
  const b = Buffer.alloc(8 + fields.length * 4);
  b.writeUInt16BE(0, 0);             // flowset id 0 = template
  b.writeUInt16BE(b.length, 2);      // flowset length
  b.writeUInt16BE(256, 4);           // template id
  b.writeUInt16BE(fields.length, 6); // field count
  let o = 8;
  for (const [t, l] of fields) { b.writeUInt16BE(t, o); b.writeUInt16BE(l, o + 2); o += 4; }
  return b;
}
function v9DataRecord(src: string, dst: string, sport: number, dport: number, proto: number, bytes: number, pkts: number): Buffer {
  const b = Buffer.alloc(21);
  writeIp(b, 0, src);
  writeIp(b, 4, dst);
  b.writeUInt16BE(sport, 8);
  b.writeUInt16BE(dport, 10);
  b[12] = proto;
  b.writeUInt32BE(bytes, 13);
  b.writeUInt32BE(pkts, 17);
  return b;
}
function v9DataFlowset(records: Buffer[]): Buffer {
  const content = Buffer.concat(records);
  const len = 4 + content.length;
  const pad = (4 - (len % 4)) % 4;     // flowsets are padded to a 4-byte boundary
  const b = Buffer.alloc(len + pad);
  b.writeUInt16BE(256, 0);             // data flowset id == template id
  b.writeUInt16BE(len + pad, 2);
  content.copy(b, 4);
  return b;
}

// IPFIX (v10): 16-byte header, set id 2 = template / >=256 = data.
function ipfixHeader(domainId = 7): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt16BE(10, 0);            // version
  b.writeUInt32BE(domainId, 12);     // observationDomainID (length/seq left 0)
  return b;
}
function ipfixTemplateSet(): Buffer {
  const fields = [[8, 4], [12, 4], [7, 2], [11, 2], [4, 1], [1, 4], [2, 4]];
  const b = Buffer.alloc(8 + fields.length * 4);
  b.writeUInt16BE(2, 0);             // set id 2 = template
  b.writeUInt16BE(b.length, 2);
  b.writeUInt16BE(256, 4);           // template id
  b.writeUInt16BE(fields.length, 6);
  let o = 8;
  for (const [t, l] of fields) { b.writeUInt16BE(t, o); b.writeUInt16BE(l, o + 2); o += 4; }
  return b;
}
function ipfixDataSet(records: Buffer[]): Buffer {
  const content = Buffer.concat(records);
  const len = 4 + content.length;
  const pad = (4 - (len % 4)) % 4;
  const b = Buffer.alloc(len + pad);
  b.writeUInt16BE(256, 0);           // data set id == template id
  b.writeUInt16BE(len + pad, 2);
  content.copy(b, 4);
  return b;
}

// ---- tests -----------------------------------------------------------------
describe('NetFlow v5 decode', () => {
  it('decodes fixed-layout v5 records', () => {
    const pkt = v5Packet([
      v5Record('192.168.1.10', '8.8.8.8', 10, 1500, 12345, 443, 6),
      v5Record('192.168.1.20', '1.1.1.1', 5, 600, 51000, 53, 17),
    ]);
    const flows = decodeNetflow(pkt, '192.168.10.41', new Map());
    expect(flows).toHaveLength(2);
    expect(flows[0]).toEqual({ srcIp: '192.168.1.10', dstIp: '8.8.8.8', srcPort: 12345, dstPort: 443, protocol: 6, bytes: 1500, packets: 10 });
    expect(flows[1]).toMatchObject({ dstPort: 53, protocol: 17, bytes: 600 });
  });
});

describe('NetFlow v9 decode (template-based)', () => {
  it('decodes data when template + data are in the same packet', () => {
    const pkt = Buffer.concat([
      v9Header(3),
      v9TemplateFlowset(),
      v9DataFlowset([
        v9DataRecord('10.0.0.5', '140.82.121.3', 40000, 443, 6, 8000, 12),
        v9DataRecord('10.0.0.6', '9.9.9.9', 33000, 53, 17, 180, 2),
      ]),
    ]);
    const flows = decodeNetflow(pkt, '10.0.0.1', new Map());
    expect(flows).toHaveLength(2);
    expect(flows[0]).toEqual({ srcIp: '10.0.0.5', dstIp: '140.82.121.3', srcPort: 40000, dstPort: 443, protocol: 6, bytes: 8000, packets: 12 });
    expect(flows[1]).toMatchObject({ dstIp: '9.9.9.9', dstPort: 53, bytes: 180 });
  });

  it('caches the template, so a later data-only packet decodes', () => {
    const cache: TemplateCache = new Map();
    const tmplPkt = Buffer.concat([v9Header(1), v9TemplateFlowset()]);
    expect(decodeNetflow(tmplPkt, '10.0.0.1', cache)).toHaveLength(0);   // no data yet

    const dataPkt = Buffer.concat([v9Header(1), v9DataFlowset([v9DataRecord('10.0.0.7', '1.1.1.1', 5000, 80, 6, 1234, 3)])]);
    const flows = decodeNetflow(dataPkt, '10.0.0.1', cache);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ srcIp: '10.0.0.7', dstPort: 80, bytes: 1234 });
  });

  it('drops data when its template has not been seen (per-exporter keying)', () => {
    const dataPkt = Buffer.concat([v9Header(1), v9DataFlowset([v9DataRecord('10.0.0.7', '1.1.1.1', 5000, 80, 6, 1234, 3)])]);
    expect(decodeNetflow(dataPkt, '10.0.0.99', new Map())).toHaveLength(0);
  });
});

describe('IPFIX (v10) decode', () => {
  it('decodes data when template + data share a packet (IE numbers match v9)', () => {
    const pkt = Buffer.concat([ipfixHeader(), ipfixTemplateSet(), ipfixDataSet([
      v9DataRecord('10.0.0.5', '140.82.121.3', 40000, 443, 6, 8000, 12),
    ])]);
    const flows = decodeNetflow(pkt, '10.0.0.1', new Map());
    expect(flows).toHaveLength(1);
    expect(flows[0]).toEqual({ srcIp: '10.0.0.5', dstIp: '140.82.121.3', srcPort: 40000, dstPort: 443, protocol: 6, bytes: 8000, packets: 12 });
  });

  it('caches the template across packets, keyed by observation domain', () => {
    const cache: TemplateCache = new Map();
    decodeNetflow(Buffer.concat([ipfixHeader(), ipfixTemplateSet()]), '10.0.0.1', cache);
    const flows = decodeNetflow(
      Buffer.concat([ipfixHeader(), ipfixDataSet([v9DataRecord('10.0.0.7', '1.1.1.1', 5000, 80, 6, 1234, 3)])]),
      '10.0.0.1', cache);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ dstPort: 80, bytes: 1234 });
  });
});

describe('decodeNetflow version guard', () => {
  it('returns nothing for unsupported versions or malformed packets (v1/sFlow/garbage)', () => {
    const v1 = Buffer.alloc(20); v1.writeUInt16BE(1, 0);
    expect(decodeNetflow(v1, '10.0.0.1', new Map())).toEqual([]);
    expect(decodeNetflow(Buffer.alloc(2), '10.0.0.1', new Map())).toEqual([]);
  });
});

describe('appFor classification', () => {
  it('labels by the well-known port (dest first, then source)', () => {
    expect(appFor(6, 40000, 443)).toEqual({ app: 'https', port: 443 });
    expect(appFor(17, 53, 40000)).toEqual({ app: 'dns', port: 53 });   // server is the source side
    expect(appFor(6, 50000, 51820)).toEqual({ app: 'wireguard', port: 51820 });
  });
  it('falls back to "other" with the lower port when unknown', () => {
    expect(appFor(6, 40000, 41000)).toEqual({ app: 'other', port: 40000 });
  });
});
