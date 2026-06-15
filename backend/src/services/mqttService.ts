// MQTT bridge with Home Assistant MQTT discovery. Publishes per-device state
// (online, cpu, mem, temp, connected ports) and accepts commands (enable/disable
// a port, PoE-cycle, Wake-on-LAN). No-op unless MQTT_URL is set.
//
// Env: MQTT_URL (mqtt://host:1883), MQTT_USERNAME, MQTT_PASSWORD,
//      MQTT_BASE_TOPIC (default switchpilot), MQTT_HA_PREFIX (default homeassistant),
//      MQTT_HA_DISCOVERY (default true).
//
// Commands (publish to these):
//   <base>/cmd/port  {"deviceId":"..","port":"Gi1/0/5","action":"enable|disable|poe-cycle"}
//   <base>/cmd/wol   {"mac":"aa:bb:cc:dd:ee:ff"}
import mqtt, { type MqttClient } from 'mqtt';
import { query } from '../db.js';
import { setPortAdmin, poeCyclePort } from './deviceComms.js';
import { sendWol } from './wolService.js';

const URL = process.env.MQTT_URL;
const BASE = process.env.MQTT_BASE_TOPIC ?? 'switchpilot';
const HA_PREFIX = process.env.MQTT_HA_PREFIX ?? 'homeassistant';
const HA = (process.env.MQTT_HA_DISCOVERY ?? 'true') !== 'false';

let client: MqttClient | null = null;
const announced = new Set<string>();   // devices whose HA discovery is published

export function startMqtt(): void {
  if (!URL) return;
  client = mqtt.connect(URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    will: { topic: `${BASE}/bridge/state`, payload: 'offline', retain: true, qos: 0 },
    reconnectPeriod: 5000,
  });
  client.on('connect', () => {
    client!.publish(`${BASE}/bridge/state`, 'online', { retain: true });
    client!.subscribe(`${BASE}/cmd/#`);
    console.log(`MQTT connected: ${URL}`);
  });
  client.on('error', err => console.warn(`MQTT error: ${err.message}`));
  client.on('message', (topic, payload) =>
    handleCommand(topic, payload.toString()).catch(e => console.warn(`MQTT command failed: ${e.message}`)));
}

async function handleCommand(topic: string, body: string): Promise<void> {
  const sub = topic.slice(`${BASE}/cmd/`.length);
  let data: any = {};
  try { data = JSON.parse(body); } catch { data = { raw: body }; }
  if (sub === 'port') {
    const { deviceId, port, action } = data;
    if (!deviceId || !port) return;
    if (action === 'enable') await setPortAdmin(deviceId, port, true);
    else if (action === 'disable') await setPortAdmin(deviceId, port, false);
    else if (action === 'poe-cycle') await poeCyclePort(deviceId, port);
  } else if (sub === 'wol') {
    await sendWol(data.mac ?? data.raw);
  }
}

function publishDiscovery(d: any, stateTopic: string): void {
  const device = {
    identifiers: [`switchpilot_${d.id}`],
    name: d.hostname,
    model: d.model || undefined,
    manufacturer: d.vendor === 'mikrotik' ? 'MikroTik' : 'Cisco',
  };
  const disc = (component: string, obj: string, cfg: object) =>
    client!.publish(
      `${HA_PREFIX}/${component}/switchpilot_${d.id}/${obj}/config`,
      JSON.stringify({ ...cfg, state_topic: stateTopic, unique_id: `sp_${d.id}_${obj}`, device }),
      { retain: true });
  disc('binary_sensor', 'online', { name: 'Online', device_class: 'connectivity', value_template: '{{ value_json.online }}', payload_on: 'ON', payload_off: 'OFF' });
  disc('sensor', 'cpu', { name: 'CPU', unit_of_measurement: '%', value_template: '{{ value_json.cpu }}', state_class: 'measurement' });
  disc('sensor', 'mem', { name: 'Memory', unit_of_measurement: '%', value_template: '{{ value_json.mem }}', state_class: 'measurement' });
  disc('sensor', 'temp', { name: 'Temperature', unit_of_measurement: '°C', device_class: 'temperature', value_template: '{{ value_json.temp }}', state_class: 'measurement' });
  disc('sensor', 'connected', { name: 'Connected ports', value_template: '{{ value_json.connected_ports }}', state_class: 'measurement' });
}

/** Publish a device's current state (and HA discovery the first time). Best-effort. */
export async function publishDevice(deviceId: string): Promise<void> {
  if (!client?.connected) return;
  try {
    const { rows } = await query<any>(
      `SELECT id, hostname, COALESCE(vendor,'cisco') vendor, model, status, cpu_pct, mem_pct, temperature_c
       FROM devices WHERE id=$1`, [deviceId]);
    const d = rows[0];
    if (!d) return;
    const p = await query<any>(
      `SELECT count(*) FILTER (WHERE oper_status='connected')::int connected, count(*)::int total
       FROM ports WHERE device_id=$1`, [deviceId]);
    const stateTopic = `${BASE}/device/${deviceId}/state`;
    client.publish(stateTopic, JSON.stringify({
      online: d.status === 'online' ? 'ON' : 'OFF',
      cpu: d.cpu_pct, mem: d.mem_pct, temp: d.temperature_c,
      connected_ports: p.rows[0]?.connected ?? 0, total_ports: p.rows[0]?.total ?? 0,
    }), { retain: true });
    if (HA && !announced.has(deviceId)) { announced.add(deviceId); publishDiscovery(d, stateTopic); }
  } catch (err: any) {
    console.warn(`MQTT publish failed for ${deviceId}: ${err.message}`);
  }
}
