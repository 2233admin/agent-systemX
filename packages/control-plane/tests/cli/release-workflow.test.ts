import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('release workflow is registered, pinned, deterministic, and attested', async () => {
  const workflow = await readFile(path.resolve(import.meta.dir, '../../../../.github/workflows/release-configs.yml'), 'utf8');
  expect(workflow).toContain("pull_request:\n    branches:\n      - main");
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain('bun-version: 1.3.14');
  const topLevel = workflow.slice(0, workflow.indexOf('jobs:'));
  expect(topLevel).toContain('permissions:\n  contents: read');
  expect(topLevel).not.toContain('contents: write');
  expect(workflow).toContain("if: github.event_name == 'pull_request'\n    permissions:\n      contents: read");
  expect(workflow).toContain("if: github.event_name == 'push'\n    permissions:\n      attestations: write\n      contents: write\n      id-token: write");
  expect(workflow).toContain('tag version $VERSION does not match package.json $PACKAGE_VERSION');
  expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
  expect(workflow).toContain('actions/attest-build-provenance@v2');
  expect(workflow).toContain('attestations: write');
  expect(workflow).toContain('id-token: write');
  expect(workflow).toContain('LC_ALL=C sha256sum configs-darwin-arm64 configs-darwin-x64 configs-linux-x64 configs-windows-x64.exe');
  for (const target of ['configs-windows-x64.exe', 'configs-linux-x64', 'configs-darwin-x64', 'configs-darwin-arm64']) expect(workflow).toContain(target);
  expect(workflow).toContain('gh release create "$GITHUB_REF_NAME" packages/control-plane/dist/*');
});
