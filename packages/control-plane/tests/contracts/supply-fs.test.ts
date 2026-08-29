import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadSupplyGroups } from '../../src/adapters/sources/supply-fs';

describe('loadSupplyGroups', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test('loads skills from the repository group/skills/skill layout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'control-plane-supply-'));
    temporaryRoots.push(root);
    const skillDirectory = path.join(root, 'plugins', 'adaptive-problem-solving', 'skills', 'problem-solving');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, 'SKILL.md'), '# problem-solving\n', 'utf8');

    const result = await loadSupplyGroups(root, ['plugins/adaptive-problem-solving']);

    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]).toMatchObject({
      kind: 'skill',
      name: 'problem-solving',
      sourceRef: 'plugins/adaptive-problem-solving/skills/problem-solving',
    });
  });
});
