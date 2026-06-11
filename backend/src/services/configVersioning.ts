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
  return (name || 'unknown').replace(/[^\w.\-]/g, '_');
}

/** Repo-relative path for a device's config file: configs/<site>/<hostname>.cfg */
function configPath(hostname: string, site?: string | null): string {
  return path.posix.join('configs', sanitize(site || 'unassigned'), `${sanitize(hostname)}.cfg`);
}

export interface CommitMeta {
  takenBy: string;          // username or 'scheduler' — becomes the git author
  reason?: string;          // free-text why (e.g. "nightly backup", "VLAN add")
  ticket?: string;          // change ticket reference
  site?: string | null;     // physical site, used for folder layout
}

/**
 * Write a config snapshot to the git repo and commit with operational metadata.
 * The committer is always SwitchPilot; the AUTHOR is the user who triggered it,
 * so `git log` / `git blame` attribute changes to real people. Reason and ticket
 * are recorded as structured trailers for auditability.
 * Returns the commit SHA, or null on no-op/error.
 */
export async function commitConfig(
  hostname: string,
  content: string,
  subject: string,
  meta: CommitMeta
): Promise<string | null> {
  try {
    await ensureRepo();
    const rel = configPath(hostname, meta.site);
    const abs = path.join(REPO, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    await exec('git', ['-C', REPO, 'add', rel]);
    const { stdout: status } = await exec('git', ['-C', REPO, 'status', '--porcelain', '--', rel]);
    if (!status.trim()) return null; // nothing changed

    // Build a message with trailers. Trailers must be in the final paragraph.
    const trailers: string[] = [];
    if (meta.reason) trailers.push(`Reason: ${meta.reason}`);
    if (meta.ticket) trailers.push(`Ticket: ${meta.ticket}`);
    trailers.push(`Changed-By: ${meta.takenBy}`);
    const message = `${subject}\n\n${trailers.join('\n')}\n`;

    const author = `${meta.takenBy} <${sanitize(meta.takenBy)}@switchpilot>`;
    await exec('git', ['-C', REPO, 'commit', `--author=${author}`, '-m', message]);
    const { stdout: sha } = await exec('git', ['-C', REPO, 'rev-parse', 'HEAD']);
    return sha.trim();
  } catch (err) {
    console.warn(`[config-git] commit failed: ${(err as Error).message}`);
    return null;
  }
}

export interface GitLogEntry {
  sha: string;
  date: string;
  author: string;
  subject: string;
  reason: string;
  ticket: string;
  path: string;     // path at that commit (handles site renames via --follow)
}

/**
 * Return git history for a device's config file. Uses --follow so the timeline
 * survives the file moving between site folders.
 */
export async function gitLog(
  hostname: string,
  site: string | null | undefined,
  limit = 50
): Promise<GitLogEntry[]> {
  try {
    await ensureRepo();
    const rel = configPath(hostname, site);
    // %x1f = unit separator between fields, %x1e = record separator between commits.
    // %(trailers:key=...) pulls our structured metadata back out.
    const fmt = ['%H', '%aI', '%an', '%s',
      '%(trailers:key=Reason,valueonly)', '%(trailers:key=Ticket,valueonly)'].join('%x1f') + '%x1e';
    const { stdout } = await exec('git', [
      '-C', REPO, 'log', `--pretty=format:${fmt}`,
      '--name-only', '--follow', `-n${limit}`, '--', rel
    ]);
    if (!stdout.trim()) return [];

    return stdout.split('\x1e').map(block => block.trim()).filter(Boolean).map(block => {
      const [meta, ...nameLines] = block.split('\n');
      const [sha, date, author, subject, reason, ticket] = meta.split('\x1f');
      // first non-empty name line is the file path at that commit
      const filePath = nameLines.map(l => l.trim()).find(Boolean) ?? rel;
      return {
        sha: (sha ?? '').trim(),
        date: (date ?? '').trim(),
        author: (author ?? '').trim(),
        subject: (subject ?? '').trim(),
        reason: (reason ?? '').trim(),
        ticket: (ticket ?? '').trim(),
        path: filePath
      };
    }).filter(e => e.sha);
  } catch {
    return [];
  }
}

/** Show config content at a specific commit. Path defaults to the current location. */
export async function gitShow(sha: string, hostname: string, site?: string | null, filePath?: string): Promise<string | null> {
  try {
    const rel = filePath || configPath(hostname, site);
    const { stdout } = await exec('git', ['-C', REPO, 'show', `${sha}:${rel}`]);
    return stdout;
  } catch {
    return null;
  }
}

/** Diff a device's config between two commits (or a commit and the working tree). */
export async function gitDiff(
  hostname: string, site: string | null | undefined, fromSha: string, toSha = 'HEAD'
): Promise<string | null> {
  try {
    const rel = configPath(hostname, site);
    const { stdout } = await exec('git', ['-C', REPO, 'diff', fromSha, toSha, '--', rel]);
    return stdout;
  } catch {
    return null;
  }
}

/** Repack/garbage-collect the repo. Uses --auto so it's a cheap no-op most days. */
export async function gitGc(): Promise<void> {
  if (!existsSync(path.join(REPO, '.git'))) return;
  await exec('git', ['-C', REPO, 'gc', '--auto', '--quiet']);
}
