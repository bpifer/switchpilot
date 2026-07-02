import { describe, it, expect } from 'vitest';
import { isStateChangingAction } from '../src/services/automationService.js';

describe('automation maintenance-window gating', () => {
  it('classifies the three device-writing actions as state-changing', () => {
    for (const a of ['restore_baseline', 'run_template', 'disable_port']) {
      expect(isStateChangingAction(a)).toBe(true);
    }
  });

  it('does not gate notify (it goes through raiseAlert, which suppresses itself)', () => {
    expect(isStateChangingAction('notify')).toBe(false);
  });

  it('treats an unknown action as non-state-changing (it errors later, not silently gated)', () => {
    expect(isStateChangingAction('bogus')).toBe(false);
    expect(isStateChangingAction('')).toBe(false);
  });
});
