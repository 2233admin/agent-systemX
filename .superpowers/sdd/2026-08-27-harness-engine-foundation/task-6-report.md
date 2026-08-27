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

- `CoordinationAdapter` exposes `getRun`, `getTask`, `getDispatch`, `getWorker`, and `getDelivery` using explicit IDs and nullable readonly allowlist DTOs.
- `DeliveryAdapter` exposes issue and pull-request reads plus HEAD-bound checks, reviews, and post-merge reads.
- `HostAdapter` exposes `probe`, `prepare`, `observe`, and `interpret`, each returning a validated capability result without workflow ownership.
- `validateCapabilityStatus`, `validateCapabilityResult`, and `isCapabilityResult` enforce the closed capability state model and evidence/reason requirements.

## Concerns

- No concrete Orca, GitHub, OMP, Claude, Codex, or OpenCode backend is included; adapters remain future implementations of the ports.
- Delivery DTOs intentionally expose only stable refs, state/conclusion/approval facts, HEAD binding, provenance metadata, and merge status. Rich backend payloads must remain outside these DTOs.
- The focused contract test and package typecheck pass; the project-wide test suite was not run per the Task 6 focused validation requirement.
