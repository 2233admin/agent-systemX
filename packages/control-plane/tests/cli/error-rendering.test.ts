import { describe, expect, test } from 'bun:test';

import { ConfigUnsupportedError } from '../../src/application/queries';
import {
  InvalidCandidateError,
  MissingSupersedesError,
  SupplySourceUnreadableError,
  SupplyUnsupportedEntryError,
} from '../../src/application/ports';
import { renderUnsupportedClient, renderQueryFailure } from '../../src/cli/render';

describe('公开错误渲染', () => {
  test('配置解析内部 reason 与未替换占位符不进入用户输出', () => {
    const output = renderQueryFailure('rev-1', new ConfigUnsupportedError('rev-1', 'INTERNAL_SENTINEL_storage'));

    expect(output).toContain('恢复');
    expect(output).not.toContain('INTERNAL_SENTINEL_storage');
    expect(output).not.toContain('{reason}');
  });

  test('候选解析内部 reason 不进入用户输出', () => {
    const output = renderQueryFailure('establish', new InvalidCandidateError('INTERNAL_SENTINEL_schema.path'));

    expect(output).toContain('候选');
    expect(output).toContain('恢复');
    expect(output).not.toContain('INTERNAL_SENTINEL_schema.path');
  });

  test('供给读取内部 Error.message 不进入用户输出', () => {
    const output = renderQueryFailure(
      'supply',
      new SupplySourceUnreadableError('demo', 'C:/private/supply', 'INTERNAL_SENTINEL_EACCES'),
    );

    expect(output).toContain('恢复');
    expect(output).not.toContain('INTERNAL_SENTINEL_EACCES');
    expect(output).not.toContain('C:/private/supply');
  });
  test('供给错误不会留下未替换的文案占位符', () => {
    const output = renderQueryFailure(
      'supply',
      new SupplyUnsupportedEntryError('vendor/demo', 'skills/demo/link', 'symbolic-link'),
    );

    expect(output).toContain('恢复');
    expect(output).not.toContain('{');
    expect(output).not.toContain('}');
  });
  test('codex 不支持文案不泄露未来适配器术语', () => {
    const output = renderUnsupportedClient('codex-cli', 'future adapter boundary / compatibility shim');

    expect(output).toContain('codex-cli');
    expect(output).toContain('恢复');
    expect(output).not.toContain('future adapter');
    expect(output).not.toContain('compatibility shim');
    expect(output).not.toContain('{reason}');
  });
  test('英文供给错误同样不留下未替换占位符', () => {
    const originalLanguage = process.env.CONFIGS_LANG;
    process.env.CONFIGS_LANG = 'en';
    try {
      const outputs = [
        renderQueryFailure('rev-1', new ConfigUnsupportedError('rev-1', 'INTERNAL_SENTINEL_storage')),
        renderUnsupportedClient('codex-cli', 'future adapter boundary / compatibility shim'),
        renderQueryFailure('establish', new InvalidCandidateError('INTERNAL_SENTINEL_candidate')),
        renderQueryFailure('revise', new MissingSupersedesError()),
        renderQueryFailure('supply', new SupplyUnsupportedEntryError('vendor/demo', 'skills/demo/link', 'symbolic-link')),
      ];

      for (const output of outputs) {
        expect(output).not.toContain('{');
        expect(output).not.toContain('}');
        expect(output).not.toContain('INTERNAL_SENTINEL');
      }
      const combined = outputs.join('\n');
      expect(combined).not.toContain('future adapter');
      expect(combined).not.toContain('compatibility shim');
    } finally {
      if (originalLanguage === undefined) delete process.env.CONFIGS_LANG;
      else process.env.CONFIGS_LANG = originalLanguage;
    }
  });
  test('命令失败包装不会重复输出内部命令前缀', () => {
    const outputs = [
      renderQueryFailure('establish', new InvalidCandidateError('INTERNAL_SENTINEL_schema.path')),
      renderQueryFailure('revise', new MissingSupersedesError()),
      renderQueryFailure('supply', new SupplySourceUnreadableError('demo', 'C:/private/supply', 'INTERNAL_SENTINEL_EACCES')),
    ];

    expect(outputs[0]).not.toContain('configs establish：');
    expect(outputs[1]).not.toContain('configs revise：');
    expect(outputs[2]).not.toContain('configs supply:');
    for (const output of outputs) {
      expect(output).not.toContain('{');
      expect(output).not.toContain('}');
    }
  });
  test('英文命令错误只保留一次上下文并使用人话', () => {
    const originalLanguage = process.env.CONFIGS_LANG;
    process.env.CONFIGS_LANG = 'en';
    try {
      const outputs = [
        renderQueryFailure('establish', new InvalidCandidateError('INTERNAL_SENTINEL_candidate')),
        renderQueryFailure('revise', new MissingSupersedesError()),
        renderQueryFailure('supply', new SupplyUnsupportedEntryError('vendor/demo', 'skills/demo/link', 'symbolic-link')),
      ];
      const combined = outputs.join('\n');

      expect(combined).not.toContain('configs establish:');
      expect(combined).not.toContain('configs revise:');
      expect(combined).not.toContain('configs supply:');
      expect(combined).not.toContain('materializing');
      expect(combined).not.toContain('parity');
      expect(combined).not.toContain('INTERNAL_SENTINEL');
      expect(combined).not.toContain('{');
      expect(combined).not.toContain('}');
      expect(combined).toContain('replace it with a regular file or directory');
    } finally {
      if (originalLanguage === undefined) delete process.env.CONFIGS_LANG;
      else process.env.CONFIGS_LANG = originalLanguage;
    }
  });
});
