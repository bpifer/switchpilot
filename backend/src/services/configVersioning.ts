import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const exec = promisify(execFile);
const REPO = path.resolve(config.configHistoryDir);

let ready = false;

async function ensureRepo(): Promise<void> {
  if (ready) return;
  await mkdir(REPO, { recursive: true });
  if (!existsSync(path.join(REPO, '.git'))) {
    await exec('git', ['-C', REPO, 'init']);
    await exec('git', ['-C', REPO, 'config', 'user.email', 'switchpilot@localhost']);
    await exec('git', ['-C', REPO, 'config', 'user.name', 'SwitchPilot']);
  }
  ready = true;
}

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

/** Write a config snapshot to the git repo and commit.  Returns the commit SHA, or null on no-op/error. */
export async function commitConfig(
  hostname: string,
  content: string,
  message: string
): Promise<string | null> {
  try {
    await ensureRepo();
    const file = `${sanitize(hostname)}.cfg`;
    await writeFile(path.join(REPO, file), content, 'utf8');
    await exec('git', ['-C', REPO, 'add', file]);
    const { stdout: status } = await exec('git', ['-C', REPO, 'status', '--porcelain']);
    if (!status.trim()) return null; // nothing changed
    await exec('git', ['-C', REPO, 'commit', '-m', message]);
    const { stdout: sha } = await exec('git', ['-C', REPO, 'rev-parse', 'HEAD']);
    return sha.trim();
  } catch (err) {
    console.warn(`[config-git] commit failed: ${(err as Error).message}`);
    return null;
  }
}

/** Return the last N git log entries for a device file in the format "sha|date|subject". */
export async function gitLog(
  hostname: string,
  limit = 20
): Promise<Array<{ sha: string; date: string; subject: string }>> {
  try {
    await ensureRepo();
    const file = `${sanitize(hostname)}.cfg`;
    const { stdout } = await exec('git', [
      '-C', REPO, 'log', `--pretty=format:%H|%ai|%s`,
      '--follow', '--', file
    ]);
    if (!stdout.trim()) return [];
    return stdout.trim().split('\n').slice(0, limit).map(line => {
      const [sha, date, ...rest] = line.split('|');
      return { sha: sha.trim(), date: date.trim(), subject: rest.join('|').trim() };
    });
  } catch {
    return [];
  }
}

/** Show the config content at a specific commit SHA. */
export async function gitShow(sha: string, hostname: string): Promise<string | null> {
  try {
    const file = `${sanitize(hostname)}.cfg`;
    const { stdout } = await exec('git', ['-C', REPO, 'show', `${sha}:${file}`]);
    return stdout;
  } catch {
    return null;
  }
}
