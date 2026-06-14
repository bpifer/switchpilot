import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { onEvent } from '../redis.js';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { hasRole, type AuthUser } from '../auth/rbac.js';
import { getDevice, sshTargetFor } from '../services/deviceComms.js';
import { openInteractiveShell } from '../cisco/interactiveShell.js';

export default async function wsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  // Browsers can't set an Authorization header on a WebSocket, so the client
  // passes a token as ?token=. Only the 30-second single-purpose nonce from
  // POST /api/auth/ws-token is accepted (ws claim required) - the session JWT
  // itself never appears in a URL or in proxy access logs.
  const authenticate = async (req: FastifyRequest, reply: any) => {
    const token = (req.query as any)?.token;
    try {
      if (!token) throw new Error('missing token');
      const claims = app.jwt.verify<{ ws?: boolean }>(token);
      if (!claims.ws) throw new Error('not a ws token');
    } catch {
      return reply.code(401).send({ error: 'Authentication required' });
    }
  };

  app.get('/ws', { websocket: true, preHandler: authenticate }, (connection) => {
    const ws = connection.socket;
    // publishEvent serialises events to JSON before publishing; relay the raw JSON string directly.
    const unsub = onEvent(json => {
      if (ws.readyState === 1 /* OPEN */) ws.send(json);
    });
    ws.on('close', unsub);
    ws.on('error', unsub);
  });

  // Interactive SSH terminal. Auth + RBAC are checked inside the handler (the
  // role isn't in the ws nonce, so it's looked up from the DB). netadmin+ only;
  // every session is audited open/close. The shell streams raw both ways.
  app.get('/ws/terminal', { websocket: true }, async (connection, req: FastifyRequest) => {
    const ws = connection.socket;
    const q = req.query as any;
    const send = (s: string) => { if (ws.readyState === 1) ws.send(s); };

    let claims: { sub?: string; ws?: boolean };
    try {
      claims = app.jwt.verify(q.token);
      if (!claims.ws) throw new Error('not a ws token');
    } catch { ws.close(1008, 'auth'); return; }

    const u = await query('SELECT username, role FROM users WHERE id=$1 AND enabled', [claims.sub]).catch(() => null);
    const user = u?.rows[0];
    if (!user || !hasRole({ role: user.role } as AuthUser, 'netadmin')) {
      send('\r\n[forbidden: requires network admin]\r\n'); ws.close(1008, 'forbidden'); return;
    }

    const device = await getDevice(q.deviceId).catch(() => null);
    if (!device) { send('\r\n[device not found]\r\n'); ws.close(1011); return; }

    let target;
    try { target = await sshTargetFor(device); }
    catch (e: any) { send(`\r\n[connection error: ${e.message}]\r\n`); ws.close(); return; }

    await audit(user.username, 'terminal.open', q.deviceId, { host: device.mgmt_ip }, req.ip).catch(() => {});
    send(`\r\nConnecting to ${device.hostname || device.mgmt_ip} as ${target.username}...\r\n`);

    let shell;
    try {
      shell = await openInteractiveShell(target, send, () => { if (ws.readyState === 1) ws.close(); });
    } catch (e: any) { send(`\r\n[ssh error: ${e.message}]\r\n`); ws.close(); return; }

    ws.on('message', (raw: Buffer) => {
      const msg = raw.toString('utf8');
      // resize control frames are JSON prefixed with \x00; everything else is keystrokes
      if (msg.startsWith('\x00')) {
        try { const r = JSON.parse(msg.slice(1)); if (r.cols && r.rows) shell!.resize(r.cols, r.rows); } catch { /* ignore */ }
        return;
      }
      shell!.write(msg);
    });
    const cleanup = () => {
      shell?.close();
      audit(user.username, 'terminal.close', q.deviceId, {}, req.ip).catch(() => {});
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}
