# Task 5 implementation report

## Status

Implemented SDD, QC/QA, iteration, push cadence, and PR review gates as pure TypeScript domain functions. No control-plane, filesystem, network, Orca, GitHub, process, lease-claim, or write operation was added.

## Changed files

- `packages/harness-engine/src/domain/review.ts`
  - Added the canonical `ReviewPackage` DTO, concrete revision validation, package validation, and pure package construction.
- `packages/harness-engine/src/gates/sdd.ts`
  - Added `validateSddGate` with BASE/HEAD freshness, package identity/range, plan/task identity, QC identity/range, and deterministic SDD/inline seat mapping.
- `packages/harness-engine/src/gates/iteration.ts`
  - Added `evaluateIterationGate` for phase 2 execute, phase 3 close, and phase 4 PR delivery. `worker_done` advances only to `InReview`; completion and delivery gates require explicit evidence booleans.
- `packages/harness-engine/src/gates/pr-review.ts`
  - Added `evaluatePushCadence` and `evaluatePrReview`, including current-head busy blocking, check/review/residual requirements, and prior-result invalidation after head changes.
- `packages/harness-engine/src/index.ts`
  - Exported the new DTOs, gate inputs/results, validators, and pure gate functions.
- `packages/harness-engine/tests/gates/sdd.test.ts`
- `packages/harness-engine/tests/gates/iteration.test.ts`
- `packages/harness-engine/tests/gates/pr-review.test.ts`
  - Added focused contract tests for missing/guessed BASE, stale head, package and QC alignment, seat mapping, worker delivery, incomplete close, phase gates, busy push cadence, unresolved reviews, and merge-ready freshness.

## Public API summary

- `ReviewPackage`, `createReviewPackage`, `validateReviewPackage`
- `SddGateInput`, `QcIdentity`, `ReviewReady`, `validateSddGate`
- `IterationGateInput`, `IterationPhase`, `PhaseTransition`, `evaluateIterationGate`
- `PushCadenceInput`, `PushDecision`, `RequiredCheck`, `RequiredReview`, `evaluatePushCadence`
- `PrReviewInput`, `MergeReady`, `evaluatePrReview`

All results use the existing Task 1 `GateResult`, `Violation`, `RecoveryAction`, and evidence contracts; existing lease, workflow, assignment, and dispatch contracts were not redefined.

## Tests run and observed result

- `bun test packages/harness-engine/tests/gates/sdd.test.ts packages/harness-engine/tests/gates/iteration.test.ts packages/harness-engine/tests/gates/pr-review.test.ts`
  - PASS: 15 tests, 0 failures, 36 assertions.
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - PASS: no diagnostics.

## Concerns

- These gates intentionally return decisions only; they do not create or persist review artifacts and do not grant push/merge permissions.
- Required check/review status vocabularies are normalized from deterministic DTO strings. An unrecognized or absent status fails closed.
- The iteration DTO represents observed completion facts as booleans. Adapters must supply those facts from trusted evidence; the gate does not infer backend success from `worker_done`.
