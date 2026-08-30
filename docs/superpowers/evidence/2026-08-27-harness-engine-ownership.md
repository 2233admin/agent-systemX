# Harness Engine Ownership Evidence

## Current ownership decision

- `capturedAt`: 2026-08-27T16:47:23Z
- `worktreePath`: `D:\projects\agent-systemX\.orca\worktrees\hammerhead`
- `branch`: `2233admin/the-request-appears-to`
- `observedRevision`: `9f957f173ae002f247f51c0df2cb853814e08c08`
- `owner`: `current principal-directed execution / harness-engine-acceptance-closure plan`
- `ownerAuthority`: `负责人当前确认的 ownership 边界`
- `decision`: `本计划只拥有下列明确列出的路径；未列入 owned paths 的文件不因内容相关、被引用或位于同一目录而被认领。`

## Owned paths confirmed for this plan

The following paths are in scope for the acceptance-closure plan. The five hard-gate documents are owned here as read-only authority references only; this evidence does not grant mutation authority over their existing WIP.

- `packages/harness-engine/src/domain/workflow.ts` — Story 5.1 scope; mutation owned and committed in `9f957f1` (`feat(harness): close deterministic plan status gate`)
- `packages/harness-engine/tests/domain/workflow.test.ts` — Story 5.1 scope; mutation owned and committed in `9f957f1` (`feat(harness): close deterministic plan status gate`)
- `docs/superpowers/evidence/2026-08-27-harness-engine-failure-ledger.md` — execution-time failure evidence
- `docs/superpowers/plans/2026-08-27-harness-engine-acceptance-closure.md` — current execution plan
- `_bmad-output/specs/spec-harness-engine/SPEC.md` — hard-gate authority reference, read-only
- `_bmad-output/specs/spec-harness-engine/validation-contract.md` — hard-gate authority reference, read-only
- `_bmad-output/planning-artifacts/architecture/architecture-harness-engine/ARCHITECTURE-SPINE.md` — hard-gate authority reference, read-only
- `_bmad-output/planning-artifacts/epics.md` (Epic 5 section) — hard-gate authority reference, read-only
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Epic 5 / Stories 5.1–5.8 entries) — hard-gate authority reference, read-only

## Protected and unowned paths

These paths or concurrent changes remain outside the plan's mutation ownership. They were not modified or claimed by this ownership decision.

- `_bmad-output/implementation-artifacts/sprint-status.yaml` concurrent WIP — protected; no status changes
- `_bmad-output/planning-artifacts/epics.md` concurrent WIP — protected; no Epic 5 document changes
- `_bmad-output/specs/spec-harness-engine/` Epic 5 spec files — protected read-only authority; no edits
- `_bmad-output/planning-artifacts/architecture/architecture-harness-engine/` Epic 5 architecture files — protected read-only authority; no edits
- `docs/superpowers/plans/2026-08-27-harness-engine-foundation.md` — protected; read-only and not this plan
- `.omp/` — unowned operational WIP; no edits or staging
- `diagrams/` — unowned WIP; no edits or staging
- `packages/harness-engine/src/domain/lease.ts`, `src/gates/worktree.ts`, `src/domain/review.ts`, `src/gates/sdd.ts` — Story 5.2 paths; not implemented or claimed here
- Other concurrent or unlisted WIP — protected and unowned; no edits, staging, deletion, or overwrite

Read-only authority-reference listing above does not override the protected/unowned mutation boundary. In particular, concurrent changes in `sprint-status.yaml` and `epics.md`, and all Epic 5 spec/architecture files, remain untouched.

## Baseline evidence linkage

The failure ledger `docs/superpowers/evidence/2026-08-27-harness-engine-failure-ledger.md` is aligned to the current immutable Story 5.1 commit `9f957f173ae002f247f51c0df2cb853814e08c08` and records zero current failure rows. Its current Windows-verifiable full-suite transcript is:

- `C:\Users\Administrator\AppData\Local\Temp\harness-engine-acceptance-9f957f1-transcript.log`
- 122 bytes, 7 lines
- SHA-256: `8205D489A9B77F1C07DA59FF404EB725B21EE55B2BBD7AE32687BFB3F9E56E08`
- Output: `129 pass`, `0 fail`, `322 expect() calls`, `Ran 129 tests across 11 files`, `exitCode=0`
- Typecheck: `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` exited `0` with no output

The owned workflow/test mutation boundary is exactly commit `9f957f1`; no lease/worktree Story 5.2 change is included. Protected/unowned WIP remains excluded.

No source code, sprint status, Epic 5 specification/architecture, `.omp/`, diagrams, or other protected WIP was changed for this evidence update.
