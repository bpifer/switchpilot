import { describe, it, expect } from 'vitest';
import { evaluateRule, type ComplianceRule } from '../src/services/complianceService.js';
import { RUNNING_CONFIG_COMPLIANT, RUNNING_CONFIG_NONCOMPLIANT } from './fixtures/cisco.js';

function rule(partial: Partial<ComplianceRule>): ComplianceRule {
  return {
    id: 'r', name: 'r', description: '', severity: 'warning',
    match_type: 'line_present', pattern: '', remediation: '', site_id: null, enabled: true,
    ...partial
  };
}

describe('evaluateRule', () => {
  it('line_present passes when the line exists, fails otherwise', () => {
    const r = rule({ match_type: 'line_present', pattern: 'aaa new-model' });
    expect(evaluateRule(r, RUNNING_CONFIG_COMPLIANT).passed).toBe(true);
    expect(evaluateRule(r, RUNNING_CONFIG_NONCOMPLIANT).passed).toBe(false);
  });

  it('line_absent fails when a forbidden line is present', () => {
    const r = rule({ match_type: 'line_absent', pattern: 'transport input telnet' });
    expect(evaluateRule(r, RUNNING_CONFIG_COMPLIANT).passed).toBe(true);   // ssh only
    expect(evaluateRule(r, RUNNING_CONFIG_NONCOMPLIANT).passed).toBe(false); // telnet present
  });

  it('regex_present anchors per-line with the m flag', () => {
    const r = rule({ match_type: 'regex_present', pattern: '^ntp server ' });
    expect(evaluateRule(r, RUNNING_CONFIG_COMPLIANT).passed).toBe(true);
    expect(evaluateRule(r, RUNNING_CONFIG_NONCOMPLIANT).passed).toBe(false);
  });

  it('regex_absent flags insecure SNMP communities', () => {
    const r = rule({ match_type: 'regex_absent', pattern: '^snmp-server community ' });
    expect(evaluateRule(r, RUNNING_CONFIG_COMPLIANT).passed).toBe(true);
    expect(evaluateRule(r, RUNNING_CONFIG_NONCOMPLIANT).passed).toBe(false);
  });

  it('reports a clear detail on failure', () => {
    const r = rule({ match_type: 'line_present', pattern: 'aaa new-model' });
    expect(evaluateRule(r, RUNNING_CONFIG_NONCOMPLIANT).detail).toContain('aaa new-model');
  });

  it('treats an invalid regex as a failed (not crashing) check', () => {
    const r = rule({ match_type: 'regex_present', pattern: '([unclosed' });
    const res = evaluateRule(r, RUNNING_CONFIG_COMPLIANT);
    expect(res.passed).toBe(false);
    expect(res.detail).toMatch(/invalid regex/i);
  });
});
