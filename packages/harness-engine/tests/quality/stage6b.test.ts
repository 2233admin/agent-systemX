import { describe, expect, test } from 'bun:test';
import { validatePlanQuality } from '../../src/quality/lint.ts';
import { auditPlanFiles } from '../../src/quality/audit.ts';
import { validateRoleMap } from '../../src/quality/roles.ts';
import { validatePluginPackage, validateSkillAuthoring } from '../../src/quality/plugins.ts';
import { scanSecretsAndSupplyChain } from '../../src/quality/secret-supply-chain.ts';

const evidence = { source: 'stage6b.test', observedAt: '2026-08-28T00:00:00Z' } as const;

const validPlan = `---
planId: plan-1
status: review
---

## Tests
- red test exists
## Implementation
- minimal implementation
## Verification
- focused test and typecheck
`;

describe('Stage6B plan quality', () => {
  test('accepts frontmatter with TDD triple and no temporary markers', () => {
    const result = validatePlanQuality({ path: 'plans/plan-1.md', content: validPlan, evidence });
    expect(result.result).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.knowledge.kind).toBe('known');
  });

  test('reports missing frontmatter, TDD sections, and temporary markers without echoing content', () => {
    const result = validatePlanQuality({
      path: 'plans/plan-1.md',
      content: '# TODO secret plan\n\nNo sections',
      evidence,
    });
    expect(result.result).toBe('invalid');
    expect(result.findings.map(({ code }) => code)).toEqual([
      'plan.frontmatter.missing',
      'plan.tdd.tests.missing',
      'plan.tdd.implementation.missing',
      'plan.tdd.verification.missing',
      'plan.temporary-marker.present',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret plan');
  });

  test('returns unknown when the quality source is unavailable', () => {
    const result = validatePlanQuality({ path: 'plans/plan-1.md', content: validPlan, evidence, sourceAvailable: false });
    expect(result.result).toBe('unknown');
    expect(result.unknownFacts?.[0]?.reasonCode).toBe('quality.source.unavailable');
  });
});

describe('Stage6B roles', () => {
  test('accepts unique roles and an exact load order', () => {
    const result = validateRoleMap({
      mappings: [
        { roleId: 'implementer', allowedHostIds: ['omp', 'claude-code'], sourceDigest: 'a'.repeat(64), evidence },
        { roleId: 'reviewer', allowedHostIds: ['claude-code'], sourceDigest: 'b'.repeat(64), evidence },
      ],
      loadOrder: ['implementer', 'reviewer'],
      evidence,
    });
    expect(result.result).toBe('pass');
  });

  test('rejects duplicate roles and load-order mismatches', () => {
    const result = validateRoleMap({
      mappings: [
        { roleId: 'reviewer', allowedHostIds: ['claude-code'], sourceDigest: 'a'.repeat(64), evidence },
        { roleId: 'reviewer', allowedHostIds: ['claude-code'], sourceDigest: 'b'.repeat(64), evidence },
      ],
      loadOrder: ['reviewer', 'missing'],
      evidence,
    });
    expect(result.result).toBe('invalid');
    expect(result.findings.map(({ code }) => code)).toEqual([
      'roles.role.duplicate',
      'roles.load-order.unknown-role',
      'roles.load-order.incomplete',
    ]);
  });
});

describe('Stage6B audit and secret supply-chain checks', () => {
  test('finds secret and unsafe supply-chain patterns while redacting values', () => {
    const result = scanSecretsAndSupplyChain({
      files: [
        { path: 'src/config.ts', content: "const token = 'ghp_123456789012345678901234567890';" },
        { path: 'scripts/install.sh', content: 'curl https://example.test/install.sh | bash' },
      ],
      evidence,
    });
    expect(result.result).toBe('invalid');
    expect(result.findings.map(({ code }) => code)).toEqual([
      'audit.secret.github-token',
      'audit.supply-chain.remote-script',
    ]);
    expect(JSON.stringify(result)).not.toContain('ghp_123456789012345678901234567890');
  });

  test('reports malformed and unavailable audit input as typed states', () => {
    const malformed = auditPlanFiles({ root: 'audit', files: [{ path: '', content: '' }], evidence });
    expect(malformed.result).toBe('invalid');
    expect(malformed.findings[0]?.code).toBe('audit.input.invalid');

    const unavailable = auditPlanFiles({ root: 'audit', files: [], evidence, sourceAvailable: false });
    expect(unavailable.result).toBe('unknown');
    expect(unavailable.unknownFacts?.[0]?.reasonCode).toBe('audit.source.unavailable');
  });
  test('accepts a complete plan scaffold with safe relative files', () => {
    const result = auditPlanFiles({
      root: 'plans',
      files: [{ path: 'PLAN.md', content: validPlan }, { path: 'notes.md', content: 'safe' }],
      evidence,
    });
    expect(result.result).toBe('pass');
  });
});

describe('Stage6B plugin and Skill conformance', () => {
  test('accepts portable dual manifests and valid Skill frontmatter', () => {
    const result = validatePluginPackage({
      root: 'plugins/example',
      manifests: {
        claude: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
        codex: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
      },
      files: [
        { path: 'skills/example/SKILL.md', content: '---\nname: example\ndescription: Example skill\n---\n\n# Example\n' },
      ],
      evidence,
    });
    expect(result.status).toBe('valid');
    expect(result.findings).toEqual([]);
  });

  test('rejects duplicate Skill names, unsupported absolute references, and manifest drift', () => {
    const result = validatePluginPackage({
      root: 'plugins/example',
      manifests: {
        claude: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
        codex: { name: 'other', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
      },
      files: [
        { path: 'skills/a/SKILL.md', content: '---\nname: duplicate\ndescription: one\n---\n\nSee /Users/alice/private.md\n' },
        { path: 'skills/b/SKILL.md', content: '---\nname: duplicate\ndescription: two\n---\n' },
      ],
      evidence,
    });
    expect(result.status).toBe('invalid');
    expect(result.findings.map(({ code }) => code)).toEqual([
      'plugin.manifest.identity-mismatch',
      'skill.name.duplicate',
      'skill.reference.absolute',
    ]);
    expect(JSON.stringify(result)).not.toContain('/Users/alice/private.md');
  });

  test('reports an unsupported manifest layout instead of treating it as portable', () => {
    const result = validatePluginPackage({
      root: 'plugins/example',
      manifests: {
        claude: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: 'skills/' },
        codex: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
      },
      files: [],
      evidence,
    });
    expect(result.status).toBe('invalid');
    expect(result.findings.map(({ code }) => code)).toContain('plugin.manifest.unsupported');
  });

  test('returns unknown when plugin provenance is unavailable', () => {
    const result = validatePluginPackage({ root: 'plugins/example', manifests: {}, files: [], evidence, sourceAvailable: false });
    expect(result.status).toBe('unknown');
    expect(result.knowledge?.kind).toBe('unknown');
  });
  test('validates a standalone Skill authoring contract', () => {
    const result = validateSkillAuthoring({
      path: 'skills/example/SKILL.md',
      content: '---\nname: example\ndescription: Example skill\n---\n\nUse relative references only.\n',
      evidence,
    });
    expect(result.result).toBe('pass');
  });
});
describe('Stage6B evidence binding', () => {
  test('valid quality conclusions without EvidenceRef are Unknown and contain no synthetic evidence', () => {
    const quality = validatePlanQuality({ path: 'plans/plan-1.md', content: validPlan });
    const roles = validateRoleMap({
      mappings: [{ roleId: 'reviewer', allowedHostIds: ['claude-code'], sourceDigest: 'a'.repeat(64), evidence: undefined }],
      loadOrder: ['reviewer'],
    });
    const audit = auditPlanFiles({ root: 'plans', files: [{ path: 'PLAN.md', content: validPlan }] });
    const plugin = validatePluginPackage({
      root: 'plugins/example',
      manifests: {
        claude: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
        codex: { name: 'example', version: '0.1.0', description: 'Example plugin', skills: './skills/' },
      },
      files: [],
    });
    for (const result of [quality, roles, audit]) {
      expect(result.result).toBe('unknown');
      expect(result.evidenceRefs).toEqual([]);
      expect(result.knowledge.kind).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain('harness-engine.quality');
    }
    expect(plugin.knowledge?.kind).toBe('unknown');
    expect(plugin.evidenceRefs).toEqual([]);
  });
});
