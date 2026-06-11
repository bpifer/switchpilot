import { query } from '../db.js';

/** Render a template's body with {{variable}} substitution into config lines. */
export async function renderTemplate(
  templateId: string,
  variables: Record<string, unknown> = {}
): Promise<string[]> {
  const { rows } = await query('SELECT * FROM templates WHERE id=$1', [templateId]);
  const tpl = rows[0];
  if (!tpl) throw Object.assign(new Error('Template not found'), { statusCode: 404 });

  const defined: { name: string; default?: string }[] = tpl.variables ?? [];
  const missing = defined.filter(v => variables[v.name] === undefined && v.default === undefined);
  if (missing.length) {
    throw Object.assign(
      new Error(`Missing template variables: ${missing.map(v => v.name).join(', ')}`),
      { statusCode: 400 });
  }

  const values: Record<string, string> = {};
  for (const v of defined) values[v.name] = String(variables[v.name] ?? v.default ?? '');
  for (const [k, v] of Object.entries(variables)) values[k] ??= String(v);

  const rendered = tpl.body.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => values[k] ?? '');
  return rendered.split('\n').map((l: string) => l.trimEnd()).filter((l: string) => l.trim());
}

/** Check a device's capabilities satisfy a template's requirements. */
export function capabilitiesSatisfied(
  required: string[],
  deviceCaps: Record<string, unknown>
): { ok: boolean; missing: string[] } {
  const missing = (required ?? []).filter(flag => !deviceCaps[flag]);
  return { ok: missing.length === 0, missing };
}
