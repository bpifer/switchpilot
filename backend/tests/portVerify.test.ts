import { describe, it, expect } from 'vitest';
import { verifyPortIntent } from '../src/services/portVerify.js';

// A running-config interface block as `show running-config interface Gi0/1` returns it.
const ACCESS_BLOCK = `Building configuration...

Current configuration : 120 bytes
!
interface GigabitEthernet0/1
 description Lab-PC
 switchport access vlan 20
 switchport mode access
 switchport voice vlan 100
end`;

describe('verifyPortIntent', () => {
  it('confirms an access edit that landed', () => {
    const v = verifyPortIntent(ACCESS_BLOCK, { mode: 'access', vlan: 20, description: 'Lab-PC', voiceVlan: 100 });
    expect(v.ok).toBe(true);
    expect(v.mismatches).toEqual([]);
    expect(v.confirmed).toEqual(expect.arrayContaining(['description', 'mode', 'access vlan', 'voice vlan']));
  });

  it('flags the field that did not land', () => {
    // Intended vlan 30, but the device still shows 20 (command silently rejected).
    const v = verifyPortIntent(ACCESS_BLOCK, { vlan: 30 });
    expect(v.ok).toBe(false);
    expect(v.mismatches).toEqual([{ field: 'access vlan', expected: '30', actual: '20' }]);
  });

  it('treats an absent access-vlan line as the default VLAN 1', () => {
    const block = `interface GigabitEthernet0/2\n switchport mode access\nend`;
    expect(verifyPortIntent(block, { vlan: 1 }).ok).toBe(true);            // default -> confirmed
    expect(verifyPortIntent(block, { vlan: 5 }).mismatches[0]).toMatchObject({ field: 'access vlan', actual: '1' });
  });

  it('confirms a cleared description (no description line)', () => {
    const block = `interface GigabitEthernet0/3\n switchport mode access\nend`;
    expect(verifyPortIntent(block, { description: '' }).ok).toBe(true);
    expect(verifyPortIntent(block, { description: 'Phone' }).mismatches[0])
      .toMatchObject({ field: 'description', expected: 'Phone', actual: '' });
  });

  it('does not check access vlan on a trunk port (avoids a false mismatch)', () => {
    const trunk = `interface GigabitEthernet0/0\n switchport trunk encapsulation dot1q\n switchport mode trunk\n switchport trunk native vlan 99\nend`;
    const v = verifyPortIntent(trunk, { vlan: 10, trunkNativeVlan: 99 });
    expect(v.mismatches.find(m => m.field === 'access vlan')).toBeUndefined();
    expect(v.confirmed).toContain('trunk native vlan');
  });

  it('leaves fields the block does not show unconfirmed (not a mismatch)', () => {
    const block = `interface GigabitEthernet0/4\n description Camera\nend`;
    const v = verifyPortIntent(block, { mode: 'access' });   // no "switchport mode" line present
    expect(v.ok).toBe(true);            // unconfirmed, but not a mismatch
    expect(v.confirmed).not.toContain('mode');
    expect(v.mismatches).toEqual([]);
  });
});
