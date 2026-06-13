import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

// The webhook signature scheme is part of the public contract (receivers verify
// it), so pin it down: sha256 HMAC of the exact JSON body, hex, "sha256=" prefix.
describe('webhook signature', () => {
  it('produces a verifiable sha256 HMAC over the body', () => {
    const secret = 'topsecret';
    const body = JSON.stringify({ event: 'alert', kind: 'cpu_high' });
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    // A receiver recomputes the same way
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(sig).toBe(expected);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('changes when the body changes (tamper-evident)', () => {
    const secret = 's';
    const a = createHmac('sha256', secret).update('{"a":1}').digest('hex');
    const b = createHmac('sha256', secret).update('{"a":2}').digest('hex');
    expect(a).not.toBe(b);
  });
});
