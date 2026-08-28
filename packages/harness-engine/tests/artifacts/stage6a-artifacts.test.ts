import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { canonicalHashFor } from '../../src/artifacts/canonical.ts';
import { normalizeHarnessPath, resolveHarnessPath } from '../../src/artifacts/paths.ts';
import { inspectArtifactSchema } from '../../src/artifacts/status-schema.ts';
import { migrateArtifact } from '../../src/artifacts/migration.ts';
import { registerProject } from '../../src/artifacts/project-register.ts';
import { validateResidualRecord, closeResidual } from '../../src/artifacts/residual.ts';

const envelope = {
  schemaVersion: 1 as const,
  artifactKind: 'workflow' as const,
  workflowId: 'workflow-1',
  revision: 1,
  value: { plans: [] },
  observedAt: '2026-08-28T00:00:00.000Z',
  canonicalHash: '',
};
const { canonicalHash: _unusedHash, ...withoutHash } = envelope;
const validEnvelope = { ...withoutHash, canonicalHash: canonicalHashFor(withoutHash) };

describe('Stage 6A artifacts', () => {
  test('resolves Windows-safe paths and rejects escape', () => {
    expect(normalizeHarnessPath('C:\\repo root\\产物')).toBe('C:/repo root/产物');
    expect(resolveHarnessPath('C:\\repo root', 'workflow-1').artifactPath).toBe('C:/repo root/workflows/workflow-1.json');
    expect(() => resolveHarnessPath('C:\\repo root', '..\\secret')).toThrow('workflowId');
  });

  test('reports schema status and migrates v1 to v2 idempotently', () => {
    expect(inspectArtifactSchema(validEnvelope)).toMatchObject({ schemaVersion: 1, compatible: true, migrationRequired: true });
    const first = migrateArtifact(validEnvelope);
    expect(first.migrated).toBe(true);
    expect(first.value.schemaVersion).toBe(2);
    const second = migrateArtifact(first.value);
    expect(second.migrated).toBe(false);
    expect(second.targetDigest).toBe(first.targetDigest);
  });

  test('rejects tampered v2 content and recomputes stable source/target digests', () => {
    const migrated = migrateArtifact(validEnvelope);
    expect(migrated.sourceDigest).toBe(canonicalHashFor(validEnvelope));
    expect(migrated.targetDigest).toBe(canonicalHashFor(migrated.value));
    expect(() => migrateArtifact({ ...migrated.value, value: { plans: [{ id: 'tampered' }] } })).toThrow('hash');
    expect(migrateArtifact(migrated.value).targetDigest).toBe(migrated.targetDigest);
  });

  test('rejects future schema and tampered hash', () => {
    expect(() => inspectArtifactSchema({ ...validEnvelope, schemaVersion: 99 })).toThrow('future');
    expect(() => inspectArtifactSchema({ ...validEnvelope, canonicalHash: '0'.repeat(64) })).toThrow('hash');
  });

  test('registers projects with expected revision and closes residuals', async () => {
    const project = await registerProject(`C:\\repo root\\stage6a-${randomUUID()}`, 'workflow-1', 'project-1', 0);
    expect(project.revision).toBe(1);
    expect(validateResidualRecord({ residualId: 'r1', owner: 'owner', decision: 'fix', target: 'code', status: 'open' })).toBe(true);
    expect(closeResidual({ residualId: 'r1', owner: 'owner', decision: 'fix', target: 'code', status: 'open' }, { source: 'test', observedAt: '2026-08-28T00:00:00.000Z' }).status).toBe('closed');
  });
});
