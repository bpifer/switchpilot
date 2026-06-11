import { query } from './db.js';

export async function audit(
  username: string,
  action: string,
  target = '',
  detail: Record<string, unknown> = {},
  ip = ''
): Promise<void> {
  try {
    await query(
      'INSERT INTO audit_log (username, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5)',
      [username, action, target, JSON.stringify(detail), ip]
    );
  } catch (err) {
    console.error('audit log write failed:', err);
  }
}
