// Resolve the driver for a device, keyed off device.vendor (falling back to
// capabilities.os for the Cisco IOS/IOS-XE/NX-OS variants).
import type { DeviceDriver } from './types.js';
import { ciscoDriver } from './cisco.js';
import { routerosDriver } from './routeros.js';

export type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan, DeviceToolId, DeviceToolOpts } from './types.js';

export function driverFor(device: { vendor?: string; capabilities?: unknown }): DeviceDriver {
  const os = (device.capabilities as any)?.os ?? 'ios';
  const vendor = device.vendor ?? (os === 'routeros' ? 'mikrotik' : 'cisco');
  if (vendor === 'mikrotik' || os === 'routeros') return routerosDriver();
  // Aruba Instant On is SNMP read-only (phase 1) - there is no CLI driver, and
  // falling through to the Cisco driver would push IOS commands at it over SSH.
  // Fail loudly with a "not supported" the routes already translate to 501/400.
  if (vendor === 'aruba' || os === 'aos-instanton') {
    throw Object.assign(
      new Error('Aruba Instant On is monitored read-only over SNMP; config changes are not supported (use the Instant On portal).'),
      { statusCode: 501 });
  }
  return ciscoDriver(os);
}
