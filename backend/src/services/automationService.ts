// Event-triggered automation rules: "if a port goes down, notify Teams",
// "if config drifts, restore baseline", "if CPU > 90%, alert", etc.
import { query } from '../db.js';
import { raiseAlert } from './alertService.js';
import { devicePushConfig, setPortAdmin } from './deviceComms.js';
import { checkDrift } from './configService.js';
import { renderTemplate } from './templateService.js';

export interface TriggerContext {
  deviceId: string;
  port?: string;
  cpu?: number;
  temp?: number;
  count?: number;
  [k: string]: unknown;
}

export async function runAutomationTrigger(trigger: string, ctx: TriggerContext): Promise<void> {
  const { rows: rules } = await query(
    'SELECT * FROM automation_rules WHERE enabled AND trigger=$1', [trigger]);
  for (const rule of rules) {
    try {
      await executeRule(rule, ctx);
    } catch (err) {
      console.error(`automation rule "${rule.name}" failed:`, err);
    }
  }
}

async function executeRule(rule: any, ctx: TriggerContext): Promise<void> {
  const cond = rule.condition ?? {};
  // generic threshold condition (e.g. cpu_high with {"threshold": 95})
  if (cond.threshold !== undefined && ctx.cpu !== undefined && ctx.cpu < cond.threshold) return;
  if (cond.threshold !== undefined && ctx.temp !== undefined && ctx.temp < cond.threshold) return;

  const params = rule.action_params ?? {};
  const d = await query('SELECT hostname FROM devices WHERE id=$1', [ctx.deviceId]);
  const hostname = d.rows[0]?.hostname ?? ctx.deviceId;

  switch (rule.action) {
    case 'notify':
      await raiseAlert(ctx.deviceId, `rule:${rule.name}`, params.severity ?? 'warning',
        params.message
          ? interpolate(params.message, { ...ctx, hostname })
          : `Automation rule "${rule.name}" triggered on ${hostname}` +
            (ctx.port ? ` (port ${ctx.port})` : ''));
      break;

    case 'restore_baseline':
      await checkDrift(ctx.deviceId); // checkDrift auto-remediates when baseline allows it
      break;

    case 'run_template': {
      if (!params.templateId) throw new Error('run_template action requires templateId');
      const lines = await renderTemplate(params.templateId, { ...params.variables, port: ctx.port ?? '' });
      await devicePushConfig(ctx.deviceId, lines, true);
      await raiseAlert(ctx.deviceId, `rule:${rule.name}`, 'info',
        `Automation rule "${rule.name}" applied template on ${hostname}`);
      break;
    }

    case 'disable_port':
      if (!ctx.port) return;
      // Vendor-aware: Cisco shutdown vs RouterOS disabled=yes via the driver.
      await setPortAdmin(ctx.deviceId, ctx.port, false);
      await raiseAlert(ctx.deviceId, `rule:${rule.name}`, 'warning',
        `Automation rule "${rule.name}" disabled port ${ctx.port} on ${hostname}`);
      break;

    default:
      throw new Error(`Unknown automation action: ${rule.action}`);
  }
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
}
