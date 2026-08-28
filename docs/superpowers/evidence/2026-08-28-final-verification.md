# Final Verification Evidence

- capturedAt: 2026-08-28T07:43:03Z
- observedRevision: `12f44e02794b3c1bfd15a641939084e5b9d0fa0c`
- branch: `2233admin/the-request-appears-to`
- scope: read-only; no remote writes or external object creation

## Commands

| command | result |
| --- | --- |
| `bun test packages/harness-engine/tests` | `240 pass`, `0 fail`, `587 expect() calls`, `28 files` |
| `bun test packages/control-plane` | `595 pass`, `1 skip`, `0 fail`, `2084 expect() calls`, `40 files` |
| `bunx tsc --noEmit -p packages/control-plane/tsconfig.json` | exit 0, no output |
| `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` | exit 0, no output |
| `cmd.exe /d /c "set HARNESS_HOST_REVISION_ID=&& bun run packages/harness-engine/src/cli/host-smoke.ts --host omp --revision-id \"\""` | `{"host":"omp","result":"not-available","reasonCode":"HARNESS_HOST_REVISION_ID.missing","scope":"read-only"}` |
| `cmd.exe /d /c "set HARNESS_ARTIFACT_ROOT=%TEMP%\\harness-final-missing&& bun run packages/harness-engine/src/cli/index.ts artifact status --root %TEMP%\\harness-final-missing --workflow-id missing --json"` | `{"command":"status","result":"unknown","violations":[{"code":"artifact.status.unavailable"}]}` |
| read-only process probe for `git push`, `gh pr merge 1`, `orca worktree rm x` | all rejected with `Read-only process command is outside the executable/subcommand allowlist` |
| hard-gates validator bundle with `real-smoke.state=not-available`, requested `Verified` | rejected: `ValidationDecision state must be Partial` |

The missing-revision path now normalizes empty/quoted/whitespace values to `not-available`; all final safety checks passed without remote writes or external object creation.
