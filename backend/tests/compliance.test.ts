import { describe, it, expect } from 'vitest';
import { evaluateRule, buildRemediationLines, type ComplianceRule } from '../src/services/complianceService.js';
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

  // Real C9300 finding: `no aaa new-model` (AAA disabled) contains the substring
  // "aaa new-model", so a naive line_present falsely reported the control as
  // present/compliant. A `no `-negation must not satisfy the affirmative check.
  it('line_present does not treat a "no <feature>" negation as the feature being present', () => {
    const r = rule({ match_type: 'line_present', pattern: 'aaa new-model' });
    expect(evaluateRule(r, 'hostname sw\nno aaa new-model\nend').passed).toBe(false);
    expect(evaluateRule(r, 'hostname sw\naaa new-model\nend').passed).toBe(true);
  });

  it('line_absent treats a "no <feature>" negation as the feature being absent', () => {
    const r = rule({ match_type: 'line_absent', pattern: 'ip http server' });
    // explicitly disabled -> absent -> PASS; explicitly enabled -> present -> FAIL
    expect(evaluateRule(r, 'no ip http server').passed).toBe(true);
    expect(evaluateRule(r, 'ip http server').passed).toBe(false);
  });

  it('a rule whose pattern is itself a negation still matches the negation line', () => {
    const r = rule({ match_type: 'line_present', pattern: 'no ip http server' });
    expect(evaluateRule(r, 'no ip http server').passed).toBe(true);
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

describe('buildRemediationLines', () => {
  it('splits a multi-line remediation into trimmed, non-empty lines', () => {
    expect(buildRemediationLines({ remediation: ' aaa new-model \n\n  login block-for 120 attempts 3 within 60  \n' }))
      .toEqual(['aaa new-model', 'login block-for 120 attempts 3 within 60']);
  });

  it('substitutes {platform_host} from PLATFORM_URL', () => {
    const prev = process.env.PLATFORM_URL;
    process.env.PLATFORM_URL = 'https://sp.example.net:8443';
    try {
      expect(buildRemediationLines({ remediation: 'logging host {platform_host}' }))
        .toEqual(['logging host sp.example.net']);
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_URL; else process.env.PLATFORM_URL = prev;
    }
  });

  it('refuses {platform_host} when PLATFORM_URL is unset', () => {
    const prev = process.env.PLATFORM_URL;
    delete process.env.PLATFORM_URL;
    try {
      expect(() => buildRemediationLines({ remediation: 'logging host {platform_host}' }))
        .toThrow(/PLATFORM_URL/);
    } finally {
      if (prev !== undefined) process.env.PLATFORM_URL = prev;
    }
  });

  it('refuses a rule with no remediation configured', () => {
    expect(() => buildRemediationLines({ remediation: '  \n ' })).toThrow(/no remediation/i);
  });
});
