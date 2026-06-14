// Resolve the driver for a device, keyed off device.vendor (falling back to
// capabilities.os for the Cisco IOS/IOS-XE/NX-OS variants).
import type { DeviceDriver } from './types.js';
import { ciscoDriver } from './cisco.js';
import { routerosDriver } from './routeros.js';

export type { DeviceDriver, PortConfigOpts, BaselineOpts, BaselinePlan } from './types.js';

export function driverFor(device: { vendor?: string; capabilities?: unknown }): DeviceDriver {
  const os = (device.capabilities as any)?.os ?? 'ios';
  const vendor = device.vendor ?? (os === 'routeros' ? 'mikrotik' : 'cisco');
  if (vendor === 'mikrotik' || os === 'routeros') return routerosDriver();
  return ciscoDriver(os);
}
