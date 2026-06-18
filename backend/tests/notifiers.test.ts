import { describe, it, expect } from 'vitest';
import {
  buildDiscord, buildNtfy, buildGotify, buildTelegram, buildPushover, buildNotifications,
  type NotifyConfig
} from '../src/services/notifiers.js';

const NONE: NotifyConfig = {
  discordWebhook: '', ntfy: { url: '', token: '' }, gotify: { url: '', token: '' },
  telegram: { token: '', chatId: '' }, pushover: { token: '', user: '' }
};
const ALL: NotifyConfig = {
  discordWebhook: 'https://discord.com/api/webhooks/1/abc',
  ntfy: { url: 'https://ntfy.sh/switches', token: 'tk_ntfy' },
  gotify: { url: 'https://gotify.example.com/', token: 'gotok' },
  telegram: { token: '123:ABC', chatId: '99' },
  pushover: { token: 'ptok', user: 'puser' }
};

describe('notification builders', () => {
  it('return null when their channel is not configured', () => {
    expect(buildDiscord('t', 'x', NONE)).toBeNull();
    expect(buildNtfy('t', 'x', 'info', NONE)).toBeNull();
    expect(buildGotify('t', 'x', 'info', NONE)).toBeNull();
    expect(buildTelegram('t', 'x', NONE)).toBeNull();
    expect(buildPushover('t', 'x', 'info', NONE)).toBeNull();
    expect(buildNotifications('t', 'x', 'critical', NONE)).toEqual([]);
  });

  it('Discord posts content to the webhook', () => {
    const r = buildDiscord('Title', 'Body', ALL)!;
    expect(r.url).toBe(ALL.discordWebhook);
    expect(JSON.parse(r.init.body as string)).toEqual({ content: '**Title**\nBody' });
  });

  it('ntfy maps severity to Priority/Tags and adds auth when a token is set', () => {
    const r = buildNtfy('Title', 'Body', 'critical', ALL)!;
    expect(r.url).toBe('https://ntfy.sh/switches');
    expect(r.init.body).toBe('Body');
    const h = r.init.headers as Record<string, string>;
    expect(h).toMatchObject({ Title: 'Title', Priority: '5', Tags: 'rotating_light', Authorization: 'Bearer tk_ntfy' });
    // warning -> priority 4, info -> 3
    expect((buildNtfy('t', 'x', 'warning', ALL)!.init.headers as any).Priority).toBe('4');
    expect((buildNtfy('t', 'x', 'info', ALL)!.init.headers as any).Priority).toBe('3');
  });

  it('Gotify trims a trailing slash, puts the token in the query, and maps priority', () => {
    const r = buildGotify('Title', 'Body', 'warning', ALL)!;
    expect(r.url).toBe('https://gotify.example.com/message?token=gotok');
    expect(JSON.parse(r.init.body as string)).toEqual({ title: 'Title', message: 'Body', priority: 5 });
  });

  it('Telegram targets the bot sendMessage API with chat_id + text', () => {
    const r = buildTelegram('Title', 'Body', ALL)!;
    expect(r.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(JSON.parse(r.init.body as string)).toMatchObject({ chat_id: '99', text: 'Title\nBody' });
  });

  it('Pushover form-encodes token/user/message and raises priority for criticals', () => {
    const r = buildPushover('Title', 'Body', 'critical', ALL)!;
    expect(r.url).toBe('https://api.pushover.net/1/messages.json');
    const body = r.init.body as URLSearchParams;
    expect(body.get('token')).toBe('ptok');
    expect(body.get('user')).toBe('puser');
    expect(body.get('message')).toBe('Body');
    expect(body.get('priority')).toBe('1');
    expect((buildPushover('t', 'x', 'info', ALL)!.init.body as URLSearchParams).get('priority')).toBe('0');
  });

  it('buildNotifications returns one request per configured channel', () => {
    expect(buildNotifications('t', 'x', 'info', ALL)).toHaveLength(5);
    const partial: NotifyConfig = { ...NONE, discordWebhook: 'https://d/1', ntfy: { url: 'https://ntfy.sh/a', token: '' } };
    expect(buildNotifications('t', 'x', 'info', partial)).toHaveLength(2);
  });
});
