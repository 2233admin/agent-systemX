# Harness Engine Failure Ledger

## Current baseline capture

The execution-time baseline command completed with zero failing assertions. Therefore this ledger has zero failure rows; the historical `10 failures/7 files` snapshot was not reused as current evidence.

- `capturedAt`: 2026-08-27T16:47:23Z
- `worktreePath`: `D:\projects\agent-systemX\.orca\worktrees\hammerhead`
- `branch`: `2233admin/the-request-appears-to`
- `observedRevision`: `9f957f173ae002f247f51c0df2cb853814e08c08`
- `suiteCommand`: `cmd.exe /v:on /d /c "(bun test packages/harness-engine/tests > %TEMP%\harness-engine-acceptance-9f957f1-output.log 2>&1 & set code=!ERRORLEVEL! & (type %TEMP%\harness-engine-acceptance-9f957f1-output.log & echo exitCode=!code!) > %TEMP%\harness-engine-acceptance-9f957f1-transcript.log & type %TEMP%\harness-engine-acceptance-9f957f1-transcript.log & exit /b !code!)"`
- `suiteExitCode`: `0`
- `testPath`: `N/A (zero current failures)`
- `assertionName`: `N/A (zero current failures)`
- `firstError`: `N/A (zero current failures)`
- `contractRef`: `N/A (zero current failures)`
- `owningFile`: `N/A (zero current failures)`
- `owner`: `N/A (zero current failures)`
- `status`: `pass`
- `rerunCommand`: `N/A (zero current failures)`
- `rerunResult`: `N/A (zero current failures)`
- `notes`: `Complete Windows cmd transcript (including exit code): C:\Users\Administrator\AppData\Local\Temp\harness-engine-acceptance-9f957f1-transcript.log (122 bytes, 7 lines, SHA-256 8205D489A9B77F1C07DA59FF404EB725B21EE55B2BBD7AE32687BFB3F9E56E08); transcript reports exitCode=0, 129 pass, 0 fail, 322 expect() calls across 11 files. Harness typecheck command bunx tsc --noEmit -p packages/harness-engine/tsconfig.json also exited 0 with no output; no current assertion required attribution or repair.`

## Failure rows

One row is required for each current failing assertion. The current run produced none.

| capturedAt | worktreePath | branch | observedRevision | suiteCommand | suiteExitCode | testPath | assertionName | firstError | contractRef | owningFile | owner | status | rerunCommand | rerunResult | notes |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
