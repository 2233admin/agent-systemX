# Task 6 implementation report

## Changed files

- `packages/harness-engine/src/ports/coordination.ts`
  - Added the dependency-inverted `CoordinationAdapter` port.
  - Added readonly run/task/dispatch/worker/delivery allowlist DTOs with required `source`, `version`, and RFC 3339 `observedAt` metadata.
  - Added runtime validators that reject unknown fields, including prompt, transcript, credential, tool-payload, and dynamic task-body fields.
- `packages/harness-engine/src/ports/delivery.ts`
  - Added explicit `DeliveryRef`/issue/pull-request refs and the `DeliveryAdapter` port.
  - Added readonly issue, pull-request, checks, reviews, and post-merge DTOs.
  - Checks, reviews, and post-merge reads require an explicit expected HEAD argument.
  - Added runtime allowlist validators for delivery DTOs.
- `packages/harness-engine/src/ports/host.ts`
  - Added closed `CapabilityStatus` (`supported | degraded | unsupported | unknown`).
  - Added `CapabilityResult` union where `supported` requires an `EvidenceRef`; non-supported states require a non-empty reason code.
  - Added `HostAdapter` and capability status/result validators. The host port carries capability facts only and no workflow state.
- `packages/harness-engine/src/index.ts`
  - Exported all new port types, DTOs, aliases, and validators.
- `packages/harness-engine/tests/core/result.test.ts`
  - Added compile-time excess-field fixtures and runtime allowlist/capability contract coverage.

## Tests run

- `bun test packages/harness-engine/tests/core/result.test.ts`
  - Observed: **8 pass, 0 fail, 51 expect() calls**.
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - Observed: **pass, no diagnostics**.
- TDD red check before implementation:
  - `bun test packages/harness-engine/tests/core/result.test.ts`
  - Observed expected failure because `src/ports/host` did not yet exist.

## Public API summary

- `CoordinationAdapter` exposes `getRun`, `getTask`, `getDispatch`, `getWorker`, and `getDelivery` using explicit IDs and `PortResult<T>` (known evidence or reasoned unknown) rather than nullable success.
- `DeliveryAdapter` exposes issue and pull-request reads plus HEAD-bound checks, reviews, `prepareMergeReady`, and post-merge reads, all returning `PortResult<T>`.
- `HostAdapter` exposes `probe(hostContext)`, `prepare(assignment)`, `observe(operation)`, and `interpret(observation)` with explicit input types and bound capability results.
- `validateCapabilityStatus`, `validateCapabilityResult`, and `isCapabilityResult` enforce the closed capability state model, host identity/version binding, and evidence/reason requirements.

## Concerns

- No concrete Orca, GitHub, OMP, Claude, Codex, or OpenCode backend is included; adapters remain future implementations of the ports.
- Delivery DTOs intentionally expose only stable refs, state/conclusion/approval facts, HEAD binding, provenance metadata, and merge status. Rich backend payloads must remain outside these DTOs.
- The focused contract test and package typecheck pass; the project-wide test suite was not run per the Task 6 focused validation requirement.

## Review-fix pass

- `DeliveryPullRequestDto` now requires concrete immutable `baseSha` and `headSha`; all HEAD-bound delivery DTOs use the existing `isConcreteRevision` contract.
- `CoordinationDeliveryDto` now requires `dispatchId` for five-object correlation.
- `PortResult<T>` reuses `Known<T>`/`Unknown`, rejects null/empty success, distinguishes `not-found` and `unavailable` reason codes, and rejects dynamic wrapper fields.
- Host capability results now require `hostId`/`hostVersion`; supported evidence carries and matches both values. Host method inputs are split into `HostContext`, `HostAssignment`, `HostOperation`, and `HostObservation`.
- Added `DeliveryAdapter.prepareMergeReady` and its DTO validator.

## Latest verification

- `bun test packages/harness-engine/tests/core/result.test.ts`
  - Observed: **9 pass, 0 fail, 63 expect() calls**.
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - Observed: **pass, no diagnostics**.
