import { describe, expect, test } from 'bun:test';
import {
  canonicalize,
  createCanonicalArtifact,
  validateCanonicalArtifact,
} from '../../src/artifacts/canonical.ts';

describe('canonical artifact contract', () => {
  test('sorts object keys but preserves array order', () => {
    expect(canonicalize({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] })).toBe(
      '{"a":{"x":3,"y":2},"list":[2,1],"z":1}',
    );
  });

  test('creates and validates a hashed versioned envelope', () => {
    const envelope = createCanonicalArtifact({
      artifactKind: 'workflow',
      workflowId: 'workflow-1',
      revision: 1,
      value: { plans: [] },
      observedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(validateCanonicalArtifact(envelope)).toEqual(envelope);
    expect(envelope.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects hash tampering and unsupported future versions', () => {
    const envelope = createCanonicalArtifact({
      artifactKind: 'workflow',
      workflowId: 'workflow-1',
      revision: 1,
      value: { plans: [] },
      observedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(() => validateCanonicalArtifact({ ...envelope, canonicalHash: '0'.repeat(64) })).toThrow('canonical hash');
    expect(() => validateCanonicalArtifact({ ...envelope, schemaVersion: 99 })).toThrow('future');
  });
});
