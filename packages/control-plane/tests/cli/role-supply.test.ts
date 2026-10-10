import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { main } from '../../src/cli/index';

describe('configs supply --role', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    delete process.env.CONTROL_PLANE_DB_PATH;
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test('emits an establish candidate for a local Role source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'control-plane-role-cli-'));
    temporaryRoots.push(root);
    const roleRoot = path.join(root, 'roles', 'coder');
    await mkdir(path.join(roleRoot, 'skills', 'minimal-change'), { recursive: true });
    await writeFile(path.join(roleRoot, 'role.toml'), [
      'id = "agentroles.coder"',
      'name = "Coder"',
      'version = "0.1.0"',
      '[contents]',
      'memory = ["memory.md"]',
      'skills = ["skills/minimal-change"]',
      '',
    ].join('\n'), 'utf8');
    await writeFile(path.join(roleRoot, 'memory.md'), '只做聚焦修改。\n', 'utf8');
    await writeFile(path.join(roleRoot, 'skills', 'minimal-change', 'SKILL.md'), '---\nname: minimal-change\ndescription: focused changes\n---\n', 'utf8');
    process.env.CONTROL_PLANE_SUPPLY_ROOT = root;

    const originalLog = console.log;
    const logged: string[] = [];
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      const exitCode = await main(['supply', '--config-name', 'coder-session', '--role', 'roles/coder']);
      expect(exitCode).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const candidate = JSON.parse(logged[0] ?? '{}') as { configName: string; capabilities: Array<{ kind: string; name: string }> };
    expect(candidate.configName).toBe('coder-session');
    expect(candidate.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'instruction', name: 'agentroles.coder:memory.md' }),
      expect.objectContaining({ kind: 'skill', name: 'minimal-change' }),
    ]));
    const candidatePath = path.join(root, 'candidate.json');
    const dbPath = path.join(root, 'control-plane.sqlite3');
    await writeFile(candidatePath, JSON.stringify(candidate), 'utf8');
    process.env.CONTROL_PLANE_DB_PATH = dbPath;
    logged.length = 0;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      const establishCode = await main(['establish', '--trigger-category', 'new-scenario', '--evidence', 'role:agentroles.coder', '--from', candidatePath]);
      expect(establishCode).toBe(0);
      expect(logged.join('\n')).toContain('coder-session');
    } finally {
      console.log = originalLog;
    }
  });
});
