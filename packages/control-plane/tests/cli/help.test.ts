import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { main } from '../../src/cli/index';

describe('configs help', () => {
  test('根 --help 与 -h 输出分组说明和示例且不创建数据库', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'configs-help-test-'));
    const dbPath = join(tempDir, 'control-plane.sqlite3');
    const originalDbPath = process.env.CONTROL_PLANE_DB_PATH;
    const originalLog = console.log;
    const logged: string[] = [];
    process.env.CONTROL_PLANE_DB_PATH = dbPath;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));

    try {
      expect(await main(['--help'])).toBe(0);
      const longHelp = logged.join('\n');
      expect(longHelp).toContain('查看与比较');
      expect(longHelp).toContain('选择与启动');
      expect(longHelp).toContain('供给与修订');
      expect(longHelp).toContain('示例');
      expect(longHelp).toContain('configs use <id> --client omp --yes');
      expect(existsSync(dbPath)).toBe(false);

      logged.length = 0;
      expect(await main(['-h'])).toBe(0);
      expect(logged.join('\n')).toContain('configs list');
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      console.log = originalLog;
      if (originalDbPath === undefined) delete process.env.CONTROL_PLANE_DB_PATH;
      else process.env.CONTROL_PLANE_DB_PATH = originalDbPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('命令级 help 输出对应 usage 与示例且不打开数据库', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'configs-command-help-test-'));
    const dbPath = join(tempDir, 'control-plane.sqlite3');
    const originalDbPath = process.env.CONTROL_PLANE_DB_PATH;
    const originalLog = console.log;
    const logged: string[] = [];
    process.env.CONTROL_PLANE_DB_PATH = dbPath;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));

    try {
      expect(await main(['list', '--help'])).toBe(0);
      expect(logged.join('\n')).toContain('configs list');
      expect(logged.join('\n')).toContain('查看与比较');
      expect(existsSync(dbPath)).toBe(false);

      logged.length = 0;
      expect(await main(['use', '--help'])).toBe(0);
      expect(logged.join('\n')).toContain('configs use <id>');
      expect(logged.join('\n')).toContain('--client');
      expect(existsSync(dbPath)).toBe(false);
      const activateHelp = logged.join('\n');
      expect(activateHelp).toContain('configs use <id> --client omp [--yes] [-- ...args]');
      expect(activateHelp).toContain('configs use <id> --client claude-code [--yes]');
      expect(activateHelp).not.toContain('claude-code [--yes] [-- ...args]');
    } finally {
      console.log = originalLog;
      if (originalDbPath === undefined) delete process.env.CONTROL_PLANE_DB_PATH;
      else process.env.CONTROL_PLANE_DB_PATH = originalDbPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
  test('未知命令后跟 help 返回根帮助而不是 usage 错误', async () => {
    const originalLog = console.log;
    const originalError = console.error;
    const logged: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    try {
      expect(await main(['wat', '--help'])).toBe(0);
      expect(logged.join('\n')).toContain('查看与比较');
      expect(logged.join('\n')).toContain('未知命令');
      expect(errors).toEqual([]);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});
