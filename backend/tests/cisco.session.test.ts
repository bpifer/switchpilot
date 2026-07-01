import { describe, it, expect } from 'vitest';
import { reloadInResponse } from '../src/cisco/sshClient.js';

describe('CiscoSshSession - reload-in prompt state machine (pure function)', () => {
  it('returns "no" when the device asks to save modified config', () => {
    expect(reloadInResponse('System configuration has been modified. Save? [yes/no]:')).toBe('no\n');
    expect(reloadInResponse('\r\nSave? [yes/no]: ')).toBe('no\n');
    expect(reloadInResponse('[yes/no]')).toBe('no\n');
  });

  it('returns Enter when the device asks to proceed with reload', () => {
    expect(reloadInResponse('Proceed with reload? [confirm]')).toBe('\n');
    expect(reloadInResponse('[confirm] ')).toBe('\n');
    // Also handles the case where running == startup (no Save? step)
    expect(reloadInResponse('\r\nProceed with reload? [confirm]\r\n')).toBe('\n');
  });

  it('returns null when no recognized prompt is present yet', () => {
    expect(reloadInResponse('C9300-LAB#')).toBeNull();
    expect(reloadInResponse('reload in 2\r\n')).toBeNull();
    expect(reloadInResponse('')).toBeNull();
    expect(reloadInResponse('Reload scheduled in 0 days, 0 hours, 02 minutes')).toBeNull();
  });

  it('[yes/no] takes priority over any incidental [confirm] text in the same buffer', () => {
    // Both patterns in one buffer should not happen in practice, but if they
    // do the Save? prompt appears first and must be answered before Proceed?.
    expect(reloadInResponse('Save? [yes/no]: Proceed? [confirm]')).toBe('no\n');
  });
});
