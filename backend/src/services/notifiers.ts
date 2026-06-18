// Extra push-notification channels for homelab/self-hosted setups, mirroring
// the built-in Teams/Slack/SMTP senders. Each builder is a pure function that
// returns the fetch args for a configured channel (or null when its env vars
// aren't set), so payloads are unit-testable without any network. dispatch()
// fires every configured channel best-effort and in parallel.
import { config } from '../config.js';

export type Severity = 'info' | 'warning' | 'critical';
export interface NotifyRequest { url: string; init: RequestInit; }

/** The slice of config these channels read (so tests can pass a literal). */
export interface NotifyConfig {
  discordWebhook: string;
  ntfy: { url: string; token: string };
  gotify: { url: string; token: string };
  telegram: { token: string; chatId: string };
  pushover: { token: string; user: string };
}

const json = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

export function buildDiscord(title: string, text: string, cfg: NotifyConfig = config): NotifyRequest | null {
  if (!cfg.discordWebhook) return null;
  // Discord caps content at 2000 chars.
  return { url: cfg.discordWebhook, init: json({ content: `**${title}**\n${text}`.slice(0, 1990) }) };
}

export function buildNtfy(title: string, text: string, severity: Severity, cfg: NotifyConfig = config): NotifyRequest | null {
  if (!cfg.ntfy.url) return null;
  const priority = severity === 'critical' ? '5' : severity === 'warning' ? '4' : '3';
  const tags = severity === 'critical' ? 'rotating_light' : severity === 'warning' ? 'warning' : 'information_source';
  const headers: Record<string, string> = { Title: title, Priority: priority, Tags: tags };
  if (cfg.ntfy.token) headers.Authorization = `Bearer ${cfg.ntfy.token}`;
  return { url: cfg.ntfy.url, init: { method: 'POST', headers, body: text } };
}

export function buildGotify(title: string, text: string, severity: Severity, cfg: NotifyConfig = config): NotifyRequest | null {
  if (!cfg.gotify.url || !cfg.gotify.token) return null;
  const priority = severity === 'critical' ? 8 : severity === 'warning' ? 5 : 2;
  const base = cfg.gotify.url.replace(/\/+$/, '');
  return { url: `${base}/message?token=${encodeURIComponent(cfg.gotify.token)}`, init: json({ title, message: text, priority }) };
}

export function buildTelegram(title: string, text: string, cfg: NotifyConfig = config): NotifyRequest | null {
  if (!cfg.telegram.token || !cfg.telegram.chatId) return null;
  return {
    url: `https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`,
    init: json({ chat_id: cfg.telegram.chatId, text: `${title}\n${text}`, disable_web_page_preview: true })
  };
}

export function buildPushover(title: string, text: string, severity: Severity, cfg: NotifyConfig = config): NotifyRequest | null {
  if (!cfg.pushover.token || !cfg.pushover.user) return null;
  const params = new URLSearchParams({
    token: cfg.pushover.token, user: cfg.pushover.user, title, message: text,
    priority: severity === 'critical' ? '1' : '0'
  });
  return { url: 'https://api.pushover.net/1/messages.json', init: { method: 'POST', body: params } };
}

/** Build the request for every configured extra channel (skips unconfigured). */
export function buildNotifications(title: string, text: string, severity: Severity, cfg: NotifyConfig = config): NotifyRequest[] {
  return [
    buildDiscord(title, text, cfg),
    buildNtfy(title, text, severity, cfg),
    buildGotify(title, text, severity, cfg),
    buildTelegram(title, text, cfg),
    buildPushover(title, text, severity, cfg)
  ].filter((r): r is NotifyRequest => r !== null);
}

/** Fire every configured extra channel, best-effort and in parallel. A single
 *  channel failure (timeout, bad token) never blocks the others. */
export async function dispatchNotifications(title: string, text: string, severity: Severity): Promise<void> {
  await Promise.allSettled(buildNotifications(title, text, severity).map(req =>
    fetch(req.url, { ...req.init, signal: AbortSignal.timeout(10_000) }).catch(() => {})));
}
