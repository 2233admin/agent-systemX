import { describe, expect, test } from 'bun:test';
import { discoverHost, doctorHost } from '../../src/host/discovery.ts';
import { verifyReleaseArtifact } from '../../src/release/verification.ts';
import { createKnowledgeCrystal, checkKnowledgeOverlap } from '../../src/knowledge/compound.ts';
import { createObservationProjection } from '../../src/observation/projection.ts';
import { parseLifecycleCommand } from '../../src/cli/parsers/lifecycle-commands.ts';
import { runLifecycleCommand } from '../../src/cli/commands/lifecycle-commands.ts';

const evidence = [{ source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z', locator: 'fixture://summary' }];

describe('Stage 6C host lifecycle', () => {
  test('tracks contract and unsupported host status without activation', () => {
    expect(discoverHost({ hostId: 'omp', version: '1', evidence })).toMatchObject({ status: 'contract' });
    expect(discoverHost({ hostId: 'codex', version: '1', evidence })).toMatchObject({ status: 'unsupported' });
    expect(doctorHost({ hostId: 'omp', version: '', evidence })).toMatchObject({ status: 'unknown' });
  });
});

describe('Stage 6C release verification', () => {
  test('fails closed on digest drift and preserves unknown on missing artifact', () => {
    expect(verifyReleaseArtifact({ artifactDigest: 'abc', observedDigest: 'def', platform: 'win32', evidence })).toMatchObject({ status: 'failed' });
    expect(verifyReleaseArtifact({ artifactDigest: '', observedDigest: '', platform: 'win32', evidence })).toMatchObject({ status: 'unknown' });
  });
});

describe('Stage 6C knowledge and observation', () => {
  test('rejects overlap and emits digest-only knowledge crystal', () => {
    expect(checkKnowledgeOverlap(['a.md', 'a.md'])).toMatchObject({ overlap: true });
    expect(createKnowledgeCrystal(['a.md'], 'digest', evidence)).toMatchObject({ contentDigest: 'digest', discoverable: true });
  });
  test('keeps observation as a projection, not a fact backend', () => {
    expect(createObservationProjection('host', 'unknown', evidence)).toMatchObject({ source: 'host', state: 'unknown' });
  });
});

describe('Stage 6C lifecycle command grammar', () => {
  test('parses the four lifecycle commands and reports missing local inputs', async () => {
    expect(parseLifecycleCommand(['host', 'doctor', '--host', 'omp', '--version', '1', '--json']).command).toBe('host-doctor');
    expect(parseLifecycleCommand(['release', 'verify', '--artifact', 'x', '--platform', 'win32', '--json']).command).toBe('release-verify');
    expect(parseLifecycleCommand(['knowledge', 'check', '--source', 'x', '--json']).command).toBe('knowledge-check');
    expect(parseLifecycleCommand(['observation', 'status', '--workflow-id', 'w', '--json']).command).toBe('observation-status');
    const result = await runLifecycleCommand(['host', 'doctor', '--host', '', '--version', '', '--json']);
    expect(result.result).toBe('not-available');
  });
});
