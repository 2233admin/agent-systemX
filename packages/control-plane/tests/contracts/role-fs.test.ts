import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildRoleCandidate, loadRoleSource } from '../../src/adapters/sources/role-fs';

describe('loadRoleSource', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test('loads role metadata, memory, and declared skills', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'control-plane-role-'));
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
    await writeFile(path.join(roleRoot, 'memory.md'), '只做聚焦的代码修改。\n', 'utf8');
    await writeFile(path.join(roleRoot, 'skills', 'minimal-change', 'SKILL.md'), '---\nname: minimal-change\ndescription: focused changes\n---\n', 'utf8');

    const role = await loadRoleSource(root, 'roles/coder');
    const candidate = buildRoleCandidate('coder-session', role);

    expect(candidate.scopeBoundary).toMatchObject({ kind: 'known', value: expect.stringContaining('agentroles.coder@0.1.0 sha256:') });
    expect(role).toMatchObject({ id: 'agentroles.coder', name: 'Coder', version: '0.1.0', sourceRef: 'roles/coder' });
    expect(role.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(candidate.capabilities).toHaveLength(2);
    expect(candidate.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'instruction', name: 'agentroles.coder:memory.md', sourceRef: 'roles/coder/memory.md' }),
      expect.objectContaining({ kind: 'skill', name: 'minimal-change', sourceRef: 'roles/coder/skills/minimal-change' }),
    ]));
  });

  test('rejects content paths outside the role directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'control-plane-role-'));
    temporaryRoots.push(root);
    const roleRoot = path.join(root, 'roles', 'unsafe');
    await mkdir(roleRoot, { recursive: true });
    await writeFile(path.join(roleRoot, 'role.toml'), [
      'id = "agentroles.unsafe"',
      'name = "Unsafe"',
      'version = "0.1.0"',
      '[contents]',
      'memory = ["../memory.md"]',
      '',
    ].join('\n'), 'utf8');

    await expect(loadRoleSource(root, 'roles/unsafe')).rejects.toThrow('escapes role source');
  });

  test('rejects a role without declared usable content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'control-plane-role-'));
    temporaryRoots.push(root);
    const roleRoot = path.join(root, 'roles', 'empty');
    await mkdir(roleRoot, { recursive: true });
    await writeFile(path.join(roleRoot, 'role.toml'), [
      'id = "agentroles.empty"',
      'name = "Empty"',
      'version = "0.1.0"',
      '[contents]',
      'skills = []',
      '',
    ].join('\n'), 'utf8');

    await expect(loadRoleSource(root, 'roles/empty')).rejects.toThrow('at least one');
  });
});
