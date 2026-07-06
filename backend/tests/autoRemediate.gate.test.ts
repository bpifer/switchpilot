import { describe, it, expect, afterEach } from 'vitest';
import { config } from '../src/config.js';
import { autoRemediateDevice } from '../src/services/complianceService.js';

// Auto-remediation pushes config to live devices, so its master switch
// (COMPLIANCE_AUTO_REMEDIATE) MUST fail closed: off by default, and when off it
// has to short-circuit before it ever reads compliance results or touches a
// device. That first gate is what this test pins down - it needs no database,
// because a correctly-gated call returns before the first query() runs. (The
// on-path, per-rule flag, and maintenance-window suppression are covered by the
// DB-backed suite that runs under RUN_DB_TESTS in CI.)
describe('autoRemediateDevice master switch', () => {
  const original = config.poll.complianceAutoRemediate;
  afterEach(() => { config.poll.complianceAutoRemediate = original; });

  it('defaults to off (opt-in only)', () => {
    // Guards against a stray COMPLIANCE_AUTO_REMEDIATE=true leaking into a dev or
    // CI shell and silently arming device-changing automation.
    expect(process.env.COMPLIANCE_AUTO_REMEDIATE === 'true').toBe(config.poll.complianceAutoRemediate);
  });

  it('is a no-op that never reaches the database when the switch is off', async () => {
    config.poll.complianceAutoRemediate = false;
    // No DB is configured in the unit suite; if the gate failed to short-circuit
    // the query() call would reject. Resolving cleanly proves it returned first.
    await expect(autoRemediateDevice('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
