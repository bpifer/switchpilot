import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export const pool = new pg.Pool({ ...config.db, max: 10 });

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Apply SQL migrations in order, tracked in schema_migrations. */
export async function migrate(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.resolve(here, '..', 'migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rowCount } = await query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
    if (rowCount) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Seed the default admin account if no users exist. */
export async function seedAdmin(): Promise<void> {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const hash = await bcrypt.hash('ChangeMe123!', 12);
  await query(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
     VALUES ('admin', 'Default Administrator', 'superadmin', $1, TRUE)`,
    [hash]
  );
  console.log('seeded default admin user (admin / ChangeMe123!) — password change required at first login');
}
