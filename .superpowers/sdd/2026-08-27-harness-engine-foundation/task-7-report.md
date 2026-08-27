# Task 7 implementation report

## Changed files

- `packages/harness-engine/src/cli/index.ts` — added the local `harness validate` and `harness status` composition root, stable failure output, usage handling, and public `runCli`/`main` entry points.
- `packages/harness-engine/tests/cli.test.ts` — added temporary-fixture tests for valid and invalid Assignment input, protected branches, malformed/future workflow artifacts, output privacy, and usage exit codes.
- `packages/harness-engine/package.json` — registered the `harness` bin entry.
- `packages/harness-engine/src/index.ts` — exported the CLI result type and entry points.

## Tests run

- `bun test packages/harness-engine/tests/cli.test.ts` — PASS, 7 tests and 26 assertions.
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` — PASS.
- `bun packages/harness-engine/src/cli/index.ts` — usage text emitted and process exit code 2 for missing arguments (expected usage behavior).

## Public API summary

- `runCli(['validate', assignmentFile])` returns exit code `0` for a passing Assignment and `1` for gate failures.
- `runCli(['status', workflowFile])` validates a versioned JSON workflow through `JsonArtifactStore` and emits only workflow, revision, plan id, plan status, and lease summaries.
- Invalid command shapes return exit code `2` without opening an artifact.
- Failure output contains stable code, phase, evidence state, kind, and recovery fields; input contents, credentials, prompt data, tool payloads, transcripts, and dynamic task text are not printed.

## Concerns

- Assignment validation uses the pure dispatch gate with deterministic local defaults for plan, task, lease, worktree, and known host capability because the CLI accepts an Assignment file rather than a live dispatch context.
- Workflow files in the ArtifactStore layout are read directly; arbitrary workflow paths are copied only to a temporary local ArtifactStore root for validation, then removed. No Orca, GitHub, host, or control-plane adapters are invoked.
