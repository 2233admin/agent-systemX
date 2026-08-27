# Task 3 Implementation Report

## Changed files

- `packages/harness-engine/src/domain/assignment.ts`
  - Added `AssignmentFields`, `AssignmentBranchForm`, and `AssignmentBranchForms` contracts.
  - Added deterministic, read-only Assignment header parsing.
  - Header parsing stops at the first task/body marker and returns only allow-listed fields.
- `packages/harness-engine/src/gates/dispatch.ts`
  - Added `validateDispatch`, `DispatchInput`, `DispatchDecision`, and structural branch/host/lease input types.
  - Added stable violations for missing required fields, unknown execution mode, branch cardinality/protection, recursion, missing identities, active lease, invalid plan status, and unknown host capability.
  - Dispatch returns only stable identity, branch, worktree, and QC seat data; it does not include prompt or task body content.
- `packages/harness-engine/tests/domain/assignment.test.ts`
  - Covers required-field omission/emptiness, all three branch declaration forms, body cutoff, and execution-mode normalization.
- `packages/harness-engine/tests/gates/dispatch.test.ts`
  - Covers valid SDD/inline seat mapping, missing fields, duplicate/missing branch forms, protected default branch and direct-on exception, unknown mode, anti-recursion, and unknown host capability.
- `packages/harness-engine/src/index.ts`
  - Re-exported the Assignment parser and dispatch gate contracts.

## Tests run and observed result

- Initial focused command before implementation:
  - `bun test packages/harness-engine/tests/domain/assignment.test.ts packages/harness-engine/tests/gates/dispatch.test.ts`
  - FAIL: both modules were absent, producing the expected missing-module errors.
- Review-fix focused command:
  - `bun test packages/harness-engine/tests/domain/assignment.test.ts packages/harness-engine/tests/gates/dispatch.test.ts`
  - PASS: 27 tests, 0 failures, 47 assertions.
- Review-fix typecheck:
  - `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - PASS: no type errors.

## Public API summary

- `parseAssignmentFields(text): Partial<AssignmentFields>` parses only the Assignment header allow-list.
- `parseAssignmentBranchForms(text): AssignmentBranchForms` reports ordered branch declarations and the direct-on reason.
- `parseAssignmentExecutionMode(text)` exposes the raw normalized mode for deterministic unknown-mode validation.
- `validateDispatch(input): GateResult<DispatchDecision>` is pure and read-only. SDD maps to `qcSeats: 3`; inline maps to `qcSeats: 1`.
- `DispatchDecision` contains only `planId`, `taskId`, `executeAs`, `branch`, `worktree`, and `qcSeats`.

## Concerns

- The brief does not define the concrete `AssignmentBranchForms` shape or all input property spellings. The implementation accepts the explicit labels `Working branch`/`Branch`/`Worktree branch`, `Branch policy`, and `Direct-on reason` (including hyphen/space variants), plus `assignmentText`, `worktreePath`, `executorId`, and `status` aliases at the gate boundary.
- Assignment parsing is fail-closed around an explicit `Assignment` heading and stops at numbered task headings and horizontal rules.
- Writable dispatch is fail-closed on lease state: only an explicitly held/active lease aligned to plan, task, and worktree passes; lease transitions remain out of scope.
- Host capability must be explicitly known (or a Known-style object with `kind` plus `value`/`evidence`); malformed and unknown shapes stay `unknown`.
- Passing dispatch evidence uses the caller-supplied `observedAt`; no timestamp is fabricated, and the gate performs no host or Orca side effects.
