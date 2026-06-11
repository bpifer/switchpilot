declare module 'net-snmp';
declare module 'ldapjs';
declare module 'node-cron' {
  export interface ScheduledTask { stop(): void; start(): void; }
  export function schedule(cron: string, fn: () => void | Promise<void>): ScheduledTask;
  const _default: { schedule: typeof schedule };
  export default _default;
}
