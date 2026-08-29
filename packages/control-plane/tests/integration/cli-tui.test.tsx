import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import { TuiApp } from '../../src/cli/tui';
import type { ConfigurationRevision } from '../../src/domain/configuration';
import { configurationName, configurationRevisionId } from '../../src/domain/configuration';
import { main } from '../../src/cli/index';

const revision: ConfigurationRevision = {
  configName: configurationName('default'),
  revisionId: configurationRevisionId('rev-tui'),
  schemaVersion: 1,
  defaultMarker: { kind: 'known', value: true },
  scopeBoundary: { kind: 'known', value: 'project' },
  availability: { kind: 'known', value: 'resolved' },
  capabilities: [],
  createdAt: '2026-08-29T00:00:00.000Z',
  triggerCategory: 'new-scenario',
  evidenceRef: 'tests/integration/cli-tui.test.tsx',
  supersedesRevisionId: null,
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CLI and TUI boundaries', () => {
  test('requires detail then confirmation before invoking onConfirm', async () => {
    let confirmed = 0;
    const screen = render(<TuiApp revisions={[revision]} onConfirm={() => { confirmed += 1; }} onCancel={() => undefined} />);
    await flush();
    screen.stdin.write('\n');
    await flush();
    expect(screen.lastFrame()).toContain('capabilities: (none)');
    expect(confirmed).toBe(0);
    screen.stdin.write('\r');
    await flush();
    expect(screen.lastFrame()).toContain('Confirm activation');
    screen.stdin.write('\n');
    screen.stdin.write('n');
    await flush();
    expect(screen.lastFrame()).toContain('Enter: prepare activation');
    screen.stdin.write('\n');
    await flush();
    screen.stdin.write('y');
    await flush();
    expect(confirmed).toBe(1);
    screen.unmount();
  });

  test('switch refuses silent fallback when no active operation exists', async () => {
    const result = await main(['switch', 'rev-tui', '--yes'], { databasePath: ':memory:' });
    expect(result).toBe(1);
  });
});
