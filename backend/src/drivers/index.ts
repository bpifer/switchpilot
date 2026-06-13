// Resolve the driver for a device. Today everything is Cisco; RouterOS and
// other vendors plug in here keyed off device.vendor / capabilities.os.
import type { DeviceDriver } from './types.js';
import { ciscoDriver } from './cisco.js';

export type { DeviceDriver, PortConfigOpts } from './types.js';

export function driverFor(device: { vendor?: string; capabilities?: unknown }): DeviceDriver {
  const os = (device.capabilities as any)?.os ?? 'ios';
  // const vendor = device.vendor ?? 'cisco';
  // switch (vendor) { case 'mikrotik': return routerosDriver(); ... }
  return ciscoDriver(os);
}
