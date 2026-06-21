// NetFlow decoder. Handles v5 (fixed record layout), v9, and IPFIX/v10 (both
// template-based, so templates learned from template sets are cached per
// exporter). sFlow is not handled. Returns normalized IPv4 flows; non-IPv4
// records (e.g. IPv6 templates) decode to empty addresses and are dropped by
// the caller.

export interface Flow {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: number;
  bytes: number;
  packets: number;
}

// A v9 template is an ordered list of {type,length}; the sum of lengths is the
// on-the-wire record size. Cached by `${exporterIp}:${sourceId}:${templateId}`.
interface V9Field { type: number; length: number; }
type V9Template = V9Field[];
export type TemplateCache = Map<string, V9Template>;

const ip4 = (buf: Buffer, off: number): string =>
  `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;

/** Read an unsigned big-endian integer of 1..8 bytes. NetFlow counters are 4 or
 *  8 bytes depending on the template; values stay within JS safe-integer range
 *  for realistic byte/packet counts. */
function uint(buf: Buffer, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  return v;
}

export function decodeNetflow(buf: Buffer, exporterIp: string, templates: TemplateCache): Flow[] {
  if (buf.length < 4) return [];
  const version = buf.readUInt16BE(0);
  if (version === 5) return decodeV5(buf);
  if (version === 9) return decodeV9(buf, exporterIp, templates);
  if (version === 10) return decodeIpfix(buf, exporterIp, templates);
  return [];   // v1 / sFlow not handled
}

function decodeV5(buf: Buffer): Flow[] {
  const count = buf.readUInt16BE(2);
  const HEADER = 24, REC = 48;
  const flows: Flow[] = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * REC;
    if (o + REC > buf.length) break;
    flows.push({
      srcIp: ip4(buf, o),
      dstIp: ip4(buf, o + 4),
      packets: buf.readUInt32BE(o + 16),
      bytes: buf.readUInt32BE(o + 20),
      srcPort: buf.readUInt16BE(o + 32),
      dstPort: buf.readUInt16BE(o + 34),
      protocol: buf[o + 38],
    });
  }
  return flows;
}

// The handful of v9/IPFIX field types we extract.
const F = { IN_BYTES: 1, IN_PKTS: 2, PROTOCOL: 4, L4_SRC_PORT: 7, IPV4_SRC: 8, L4_DST_PORT: 11, IPV4_DST: 12 };

function decodeV9(buf: Buffer, exporterIp: string, templates: TemplateCache): Flow[] {
  const sourceId = buf.readUInt32BE(16);
  const flows: Flow[] = [];
  let off = 20;   // v9 header is 20 bytes; walk flowsets by their length field
  while (off + 4 <= buf.length) {
    const flowsetId = buf.readUInt16BE(off);
    const length = buf.readUInt16BE(off + 2);
    if (length < 4 || off + length > buf.length) break;
    const end = off + length;

    if (flowsetId === 0) {
      // Template flowset: one or more templates back to back.
      let p = off + 4;
      while (p + 4 <= end) {
        const templateId = buf.readUInt16BE(p);
        const fieldCount = buf.readUInt16BE(p + 2);
        p += 4;
        const fields: V9Template = [];
        for (let f = 0; f < fieldCount && p + 4 <= end; f++) {
          fields.push({ type: buf.readUInt16BE(p), length: buf.readUInt16BE(p + 2) });
          p += 4;
        }
        templates.set(`${exporterIp}:${sourceId}:${templateId}`, fields);
      }
    } else if (flowsetId === 1) {
      // Options template - not needed for traffic accounting; skip.
    } else {
      // Data flowset: records matching the template whose id == flowsetId.
      const tmpl = templates.get(`${exporterIp}:${sourceId}:${flowsetId}`);
      if (tmpl) {
        const recLen = tmpl.reduce((s, fld) => s + fld.length, 0);
        if (recLen > 0) {
          for (let p = off + 4; p + recLen <= end; p += recLen) {
            flows.push(readV9Record(buf, p, tmpl));
          }
        }
      }
    }
    off = end;
  }
  return flows.filter(fl => fl.srcIp && fl.dstIp);
}

function readV9Record(buf: Buffer, start: number, tmpl: V9Template): Flow {
  const fl: Flow = { srcIp: '', dstIp: '', srcPort: 0, dstPort: 0, protocol: 0, bytes: 0, packets: 0 };
  let o = start;
  for (const field of tmpl) {
    switch (field.type) {
      case F.IPV4_SRC:     fl.srcIp = ip4(buf, o); break;
      case F.IPV4_DST:     fl.dstIp = ip4(buf, o); break;
      case F.L4_SRC_PORT:  fl.srcPort = uint(buf, o, field.length); break;
      case F.L4_DST_PORT:  fl.dstPort = uint(buf, o, field.length); break;
      case F.PROTOCOL:     fl.protocol = uint(buf, o, field.length); break;
      case F.IN_BYTES:     fl.bytes = uint(buf, o, field.length); break;
      case F.IN_PKTS:      fl.packets = uint(buf, o, field.length); break;
    }
    o += field.length;
  }
  return fl;
}

// IPFIX (RFC 7011 / NetFlow v10): like v9 but a 16-byte header, set IDs (2 =
// template, 3 = options, >=256 = data) instead of flowset IDs, an observation
// domain ID in place of the source ID, and optional enterprise fields. The
// information-element numbers for the fields we read match v9, so data records
// reuse readV9Record. Variable-length fields (length 0xffff) are skipped.
function decodeIpfix(buf: Buffer, exporterIp: string, templates: TemplateCache): Flow[] {
  const domainId = buf.readUInt32BE(12);   // observationDomainID
  const flows: Flow[] = [];
  let off = 16;   // IPFIX header is 16 bytes; walk sets by their length field
  while (off + 4 <= buf.length) {
    const setId = buf.readUInt16BE(off);
    const length = buf.readUInt16BE(off + 2);
    if (length < 4 || off + length > buf.length) break;
    const end = off + length;

    if (setId === 2) {
      // Template set: one or more templates back to back.
      let p = off + 4;
      while (p + 4 <= end) {
        const templateId = buf.readUInt16BE(p);
        const fieldCount = buf.readUInt16BE(p + 2);
        p += 4;
        const fields: V9Template = [];
        for (let f = 0; f < fieldCount && p + 4 <= end; f++) {
          const rawType = buf.readUInt16BE(p);
          const len = buf.readUInt16BE(p + 2);
          p += 4;
          if (rawType & 0x8000) p += 4;   // enterprise field: skip the 4-byte PEN
          fields.push({ type: rawType & 0x7fff, length: len });
        }
        templates.set(`${exporterIp}:${domainId}:${templateId}`, fields);
      }
    } else if (setId >= 256) {
      // Data set matching the template whose id == setId.
      const tmpl = templates.get(`${exporterIp}:${domainId}:${setId}`);
      if (tmpl && !tmpl.some(fld => fld.length === 0xffff)) {
        const recLen = tmpl.reduce((s, fld) => s + fld.length, 0);
        if (recLen > 0) {
          for (let p = off + 4; p + recLen <= end; p += recLen) {
            flows.push(readV9Record(buf, p, tmpl));
          }
        }
      }
    }
    // setId === 3 (options template) is ignored.
    off = end;
  }
  return flows.filter(fl => fl.srcIp && fl.dstIp);
}
