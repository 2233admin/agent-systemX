import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteConfigRevisionRepository } from '../../src/adapters/sqlite/repository';
import { main } from '../../src/cli/index';

let tempDir: string;
let dbPath: string;
let originalDbPath: string | undefined;
let originalLog: typeof console.log;
let logs: string[];

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-human-usable-'));
  dbPath = path.join(tempDir, 'control-plane.sqlite3');
  originalDbPath = process.env.CONTROL_PLANE_DB_PATH;
  process.env.CONTROL_PLANE_DB_PATH = dbPath;
  originalLog = console.log;
  logs = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
});

afterEach(() => {
  console.log = originalLog;
  if (originalDbPath === undefined) delete process.env.CONTROL_PLANE_DB_PATH;
  else process.env.CONTROL_PLANE_DB_PATH = originalDbPath;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('configs real CLI smoke', () => {
  test('通过真实 configs CLI 启动 OMP 并让 OMP --help 正常退出', async () => {
    const ompPath = Bun.which('omp');
    if (ompPath === null) return;

    const candidatePath = path.join(tempDir, 'candidate.json');
    await Bun.write(candidatePath, JSON.stringify({
      configName: 'cli-real-smoke',
      defaultMarker: { kind: 'known', value: false },
      scopeBoundary: { kind: 'known', value: 'real CLI smoke' },
      availability: { kind: 'known', value: 'resolved' },
      skills: [],
    }));

    expect(await main([
      'establish',
      '--trigger-category',
      'new-scenario',
      '--evidence',
      'smoke://real-cli',
      '--from',
      candidatePath,
    ])).toBe(0);

    const repository = new SqliteConfigRevisionRepository(dbPath);
    const revisions = await repository.listAll();
    repository.close();
    expect(revisions).toHaveLength(1);
    const revisionId = revisions[0]?.revisionId;
    expect(revisionId).toBeDefined();

    expect(await main(['use', revisionId!, '--client', 'omp', '--yes', '--', '--help'])).toBe(0);
    expect(logs.some((line) => line.includes('终端控制权') || line.includes('Handing off'))).toBe(true);
    expect(logs.some((line) => line.includes('阶段：') || line.includes('Phase:'))).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });
});
