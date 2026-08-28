import { describe, expect, test } from 'bun:test';
import { runCli } from '../../src/cli/index.ts';

describe('smoke evidence CLI', () => {
  test('records missing Orca prerequisites as not-available without a real call', async () => {
    const result = await runCli(['smoke', 'evidence', '--backend', 'orca', '--result', 'not-available', '--missing', 'HARNESS_ORCA_RUN_ID', '--json']);
    expect(result.exitCode).toBe(0);
    const evidence = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(evidence).toMatchObject({ backend: 'orca', result: 'not-available', permission: 'read-only', scope: 'read-only' });
    expect(evidence.objectRefs).toEqual([]);
  });

  test('records missing GitHub prerequisites as not-available', async () => {
    const result = await runCli(['smoke', 'evidence', '--backend', 'github', '--result', 'not-available', '--missing', 'HARNESS_GITHUB_OWNER,HARNESS_GITHUB_REPOSITORY', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"result":"not-available"');
    expect(result.stdout).toContain('HARNESS_GITHUB_OWNER');
  });

  test('rejects malformed smoke evidence arguments without invoking anything', async () => {
    const result = await runCli(['smoke', 'evidence', '--backend', 'orca', '--json']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('smoke evidence');
  });
});
