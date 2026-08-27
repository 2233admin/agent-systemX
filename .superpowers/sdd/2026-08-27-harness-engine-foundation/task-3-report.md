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

- `bun test packages/harness-engine/tests/domain/assignment.test.ts packages/harness-engine/tests/gates/dispatch.test.ts`
  - PASS: 16 tests, 0 failures, 31 assertions.
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - PASS: no type errors.
- The focused test command was also run before implementation and failed with the expected missing-module errors for the absent parser and gate.

## Public API summary

- `parseAssignmentFields(text): Partial<AssignmentFields>` parses only the Assignment header allow-list.
- `parseAssignmentBranchForms(text): AssignmentBranchForms` reports ordered branch declarations and the direct-on reason.
- `parseAssignmentExecutionMode(text)` exposes the raw normalized mode for deterministic unknown-mode validation.
- `validateDispatch(input): GateResult<DispatchDecision>` is pure and read-only. SDD maps to `qcSeats: 3`; inline maps to `qcSeats: 1`.
- `DispatchDecision` contains only `planId`, `taskId`, `executeAs`, `branch`, `worktree`, and `qcSeats`.

## Concerns

- The brief does not define the concrete `AssignmentBranchForms` shape or all input property spellings. The implementation accepts the explicit labels `Working branch`/`Branch`/`Worktree branch`, `Branch policy`, and `Direct-on reason` (including hyphen/space variants), plus `assignmentText`, `worktreePath`, `executorId`, and `status` aliases at the gate boundary.
- Lease transitions remain intentionally out of scope. The gate only consumes structural lease state and rejects an already held/active lease.
- The gate uses a deterministic static evidence timestamp because this task has no clock/evidence adapter; it performs no host or Orca side effects.
