// Wake-on-LAN. Sends a magic packet (6x 0xFF + the MAC repeated 16 times) as a
// UDP broadcast. Reaches devices on the same L2 segment as the platform host.
import dgram from 'node:dgram';

/** Send a WoL magic packet for `mac`. Default broadcasts to the local segment. */
export function sendWol(mac: string, broadcast = '255.255.255.255', port = 9): Promise<void> {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) throw Object.assign(new Error('A valid MAC address is required'), { statusCode: 400 });
  const macBuf = Buffer.from(hex, 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBuf)]);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', err => { try { sock.close(); } catch { /* */ } reject(err); });
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(packet, 0, packet.length, port, broadcast, err => {
        try { sock.close(); } catch { /* */ }
        err ? reject(err) : resolve();
      });
    });
  });
}
