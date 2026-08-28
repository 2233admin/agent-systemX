import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalHashFor } from '../../src/artifacts/canonical.ts';
import { runCli } from '../../src/cli/index.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('artifact CLI commands', () => {
  test('reports local path and missing status without external access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-artifact-cli-'));
    roots.push(root);
    const path = await runCli(['artifact', 'path', '--root', root, '--workflow-id', 'workflow-1', '--json']);
    expect(path.exitCode).toBe(0);
    expect(JSON.parse(path.stdout)).toMatchObject({ command: 'path', result: 'pass' });
    const status = await runCli(['artifact', 'status', '--root', root, '--workflow-id', 'workflow-1', '--json']);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ command: 'status', result: 'unknown' });
  });

  test('doctor reports missing local artifact without external access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-artifact-cli-'));
    roots.push(root);
    const result = await runCli(['artifact', 'doctor', '--root', root, '--workflow-id', 'workflow-1', '--json']);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'doctor', result: 'not-available' });
  });

  test('rejects path escape and malformed flags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-artifact-cli-'));
    roots.push(root);
    const escaped = await runCli(['artifact', 'path', '--root', root, '--workflow-id', '..\\secret', '--json']);
    expect(escaped.exitCode).toBe(1);
    expect(escaped.stdout).toContain('artifact.path.invalid');
    const malformed = await runCli(['artifact', 'status', '--root', root, '--json']);
    expect(malformed.exitCode).toBe(2);
  });

  test('replays identical migration and blocks a different source target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-artifact-cli-'));
    const source = join(root, 'source.json');
    roots.push(root);
    const base = { schemaVersion: 1 as const, artifactKind: 'workflow' as const, workflowId: 'workflow-1', revision: 1, value: { plans: [] }, observedAt: '2026-08-28T00:00:00.000Z' };
    await writeFile(source, JSON.stringify({ ...base, canonicalHash: canonicalHashFor(base) }));
    const args = ['artifact', 'migrate', '--root', root, '--workflow-id', 'workflow-1', '--source', source, '--json'];
    expect((await runCli(args)).exitCode).toBe(0);
    expect((await runCli(args)).stdout).toContain('\"migrated\":false');
    const changed = { ...base, value: { plans: [{ id: 'different' }] } };
    await writeFile(source, JSON.stringify({ ...changed, canonicalHash: canonicalHashFor(changed) }));
    const conflict = await runCli(args);
    expect(conflict.exitCode).toBe(0);
    expect(conflict.stdout).toContain('artifact.migrate.conflict');
  });
});
