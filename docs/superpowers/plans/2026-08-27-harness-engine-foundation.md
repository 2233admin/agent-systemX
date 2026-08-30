# Harness Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个不依赖 `control-plane`、Orca 或 GitHub 内部实现的 `harness-engine` 基础包，统一工作流事实、Assignment/Dispatch、Lease/Worktree、SDD 和 QC gate。

**Architecture:** 新增 `packages/harness-engine` 纯 TypeScript/Bun 包。领域层只处理版本化 DTO、状态转换和纯 gate 函数；JSON ArtifactStore、CLI、Orca/GitHub adapter 留在端口或适配层。第一切片只交付可机械验证的本地事实与门禁，不改变现有 `packages/control-plane` 行为。

**Tech Stack:** TypeScript、Bun、`bun:test`、Node/Bun 标准库；首轮本地 artifact 使用版本化 JSON，不新增运行时第三方依赖。

**Spec:** `_bmad-output/specs/spec-harness-engine/SPEC.md`

## Global Constraints

- MUST 保留 `packages/control-plane` 的配置修订、OMP/Claude 装配、隐私和启动职责不变。
- MUST 新建独立 `packages/harness-engine`；领域内核 MUST NOT 导入 `packages/control-plane` 内部模块、Orca SDK、GitHub SDK、SQLite、文件系统或进程环境。
- MUST 使用 `Known(value, evidenceRef, observedAt)` 与 `Unknown(reasonCode, observedAt, recovery)`，不得用 `false`、空数组或缺字段表示 Unknown。
- MUST 将 Plan 状态限制为 `Todo | InProgress | InReview | Blocked | Done`。
- MUST 将 Gate 结果限制为 `pass | fail | blocked | unknown`。
- MUST 将可写操作绑定到 workflow/plan、branch/worktree 和 execution lease；integration merge lease 必须独占。
- MUST 让 `worker_done` 最多推动 Plan 到 `InReview`，不得直接推动 `Done`。
- MUST 让 SDD review package 绑定真实 `baseSha` 与 `headSha`，不得用 `HEAD~1` 猜 diff。
- MUST 默认把 `sdd` 映射为 QC tri-review；只有 `inline` 才允许 single-seat。
- MUST 保留 Orca、GitHub、OMP、Claude、Codex、OpenCode 的能力不确定性；fixture 或文档不得冒充真实支持。
- MUST NOT 引入 daemon、常驻轮询、自动重派、第三套实时 Task/Dispatch 服务或跨宿主配置等价。
- 每个 task 完成后运行其列出的 focused test；不运行项目级全套测试，直到最后一个验证 task。

## Exact File List

- Create: `packages/harness-engine/package.json` — 独立包元数据与 `test`/`typecheck` 脚本。
- Create: `packages/harness-engine/tsconfig.json` — Bun/TypeScript 编译配置。
- Create: `packages/harness-engine/src/core/result.ts` — GateResult、EvidenceRef、Known/Unknown、Violation、RecoveryAction。
- Create: `packages/harness-engine/src/core/ids.ts` — 稳定 ID、schemaVersion、revision 和时间类型。
- Create: `packages/harness-engine/src/domain/workflow.ts` — WorkflowSnapshot、PlanRow、状态转换和 revision 条件。
- Create: `packages/harness-engine/src/domain/assignment.ts` — Assignment 字段和 branch form 类型/解析。
- Create: `packages/harness-engine/src/domain/lease.ts` — execution/integration lease 类型和转换。
- Create: `packages/harness-engine/src/domain/review.ts` — BASE/HEAD review package、QC/QA 事实。
- Create: `packages/harness-engine/src/ports/artifacts.ts` — ArtifactStore 与条件写入端口。
- Create: `packages/harness-engine/src/ports/coordination.ts` — Orca CoordinationAdapter 端口 DTO。
- Create: `packages/harness-engine/src/ports/delivery.ts` — GitHub DeliveryAdapter 端口 DTO。
- Create: `packages/harness-engine/src/ports/host.ts` — HostAdapter 与 capability snapshot 合同。
- Create: `packages/harness-engine/src/adapters/json/json-artifact-store.ts` — 版本化 JSON ArtifactStore。
- Create: `packages/harness-engine/src/gates/dispatch.ts` — Assignment/branch/anti-recursion/QC seat gate。
- Create: `packages/harness-engine/src/gates/worktree.ts` — worktree/branch/lease alignment gate。
- Create: `packages/harness-engine/src/gates/sdd.ts` — BASE SHA/review package/QC alignment gate。
- Create: `packages/harness-engine/src/gates/iteration.ts` — Phase 2/3/4 和 push cadence 的纯 gate。
- Create: `packages/harness-engine/src/gates/pr-review.ts` — head/check/review merge-ready 与 tally 类型合同。
- Create: `packages/harness-engine/src/index.ts` — public exports，只导出稳定合同和纯 gate。
- Create: `packages/harness-engine/src/cli/index.ts` — 首轮 `harness validate` 与 `harness status` 薄 CLI。
- Create: `packages/harness-engine/tests/core/result.test.ts` — Known/Unknown/GateResult 合同测试。
- Create: `packages/harness-engine/tests/domain/workflow.test.ts` — Plan 状态、revision、Done 条件测试。
- Create: `packages/harness-engine/tests/domain/assignment.test.ts` — Assignment 与 branch form 解析测试。
- Create: `packages/harness-engine/tests/domain/lease.test.ts` — lease claim/release/steal 负例测试。
- Create: `packages/harness-engine/tests/gates/dispatch.test.ts` — dispatch gate 正负例。
- Create: `packages/harness-engine/tests/gates/worktree.test.ts` — worktree/lease alignment 正负例。
- Create: `packages/harness-engine/tests/gates/sdd.test.ts` — review package、QC、QA 负例。
- Create: `packages/harness-engine/tests/gates/iteration.test.ts` — phase/push cadence gate 测试。
- Create: `packages/harness-engine/tests/gates/pr-review.test.ts` — head freshness 与 merge-ready 测试。
- Create: `packages/harness-engine/tests/adapters/json-artifact-store.test.ts` — JSON 版本化条件写入测试。
- Create: `packages/harness-engine/tests/cli.test.ts` — CLI validate/status 输出和失败码测试。

---

### Task 1: Scaffold the isolated engine package and core result contracts

**Files:**
- Create: `packages/harness-engine/package.json`
- Create: `packages/harness-engine/tsconfig.json`
- Create: `packages/harness-engine/src/core/result.ts`
- Create: `packages/harness-engine/src/core/ids.ts`
- Create: `packages/harness-engine/src/index.ts`
- Test: `packages/harness-engine/tests/core/result.test.ts`

**Interfaces:**
- Produces `EvidenceRef { source: string; observedAt: string; locator?: string }`.
- Produces `Known<T> { kind: 'known'; value: T; evidence: EvidenceRef }` and `Unknown { kind: 'unknown'; reasonCode: string; observedAt: string; recovery?: string }`.
- Produces `GateResult<T> = { kind: 'pass'; value: T; evidence: readonly EvidenceRef[] } | { kind: 'fail' | 'blocked' | 'unknown'; violations: readonly Violation[]; recovery: readonly RecoveryAction[] }`.
- Produces `StableIdentity { workflowId: string; planId: string; taskId?: string }` and `ArtifactRevision { schemaVersion: number; revision: number; updatedAt: string }`.
- `src/index.ts` exports only public core/domain/gate types; no adapter internals.

- [ ] **Step 1: Write the failing tests**

  Add tests for `Known`/`Unknown` discriminants, gate result kind closure, evidence fields, non-empty violation codes, ISO timestamp acceptance, and rejection of an empty stable identity. Add a package-level test command that discovers only `packages/harness-engine/tests/**/*.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/core/result.test.ts`

  Expected: FAIL because the package and contracts do not exist.

- [ ] **Step 3: Write the minimal implementation**

  Define discriminated unions with readonly fields. Validate only structural invariants required by the spec: non-empty IDs, non-empty violation codes, and RFC 3339 timestamps. Do not add a generic schema framework or import a runtime validation dependency. Export the contracts from `src/index.ts` without exporting the future JSON/Orca/GitHub adapters.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/core/result.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS and zero TypeScript errors.

### Task 2: Implement workflow snapshots and the versioned JSON ArtifactStore

**Files:**
- Create: `packages/harness-engine/src/domain/workflow.ts`
- Create: `packages/harness-engine/src/ports/artifacts.ts`
- Create: `packages/harness-engine/src/adapters/json/json-artifact-store.ts`
- Create: `packages/harness-engine/tests/domain/workflow.test.ts`
- Create: `packages/harness-engine/tests/adapters/json-artifact-store.test.ts`
- Modify: `packages/harness-engine/src/index.ts`

**Interfaces:**
- Produces `PlanStatus = 'Todo' | 'InProgress' | 'InReview' | 'Blocked' | 'Done'`.
- Produces `PlanRow { id: string; title: string; status: PlanStatus; metadata: Readonly<Record<string, unknown>>; executionLease?: ExecutionLease }`.
- Produces `WorkflowSnapshot { schemaVersion: 1; revision: number; workflowId: string; plans: readonly PlanRow[]; integrationMergeLease?: IntegrationMergeLease }`.
- Produces `ArtifactStore.readWorkflow(workflowId): Promise<WorkflowSnapshot | null>` and `writeWorkflow(expectedRevision: number, next: WorkflowSnapshot): Promise<void>`.
- `writeWorkflow` rejects when the on-disk revision differs from `expectedRevision`; it creates the parent directory and replaces the JSON file through a same-directory temporary file plus rename.

- [ ] **Step 1: Write the failing tests**

  Test every Plan status transition, rejection of `Done` while a required lease or required evidence is present, revision mismatch rejection, idempotent read of a missing workflow, and atomic replacement using a temporary directory. Assert that prompt, transcript, credential, tool payload, and dynamic task fields are not part of the serialized DTO.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/domain/workflow.test.ts packages/harness-engine/tests/adapters/json-artifact-store.test.ts`

  Expected: FAIL because workflow types and ArtifactStore are absent.

- [ ] **Step 3: Write the minimal implementation**

  Implement the status transition function as a pure function. Keep `Done` validation narrow: the domain accepts an explicit `CompletionEvidence` input and refuses completion when the evidence says a lease remains or required review/QA is missing. Implement JSON read/write with explicit columns, `schemaVersion`, `revision`, and `updatedAt`; reject malformed or future schema versions instead of silently migrating them.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/domain/workflow.test.ts packages/harness-engine/tests/adapters/json-artifact-store.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS with revision-conflict and privacy assertions.

### Task 3: Implement Assignment parsing and the dispatch gate

**Files:**
- Create: `packages/harness-engine/src/domain/assignment.ts`
- Create: `packages/harness-engine/src/gates/dispatch.ts`
- Create: `packages/harness-engine/tests/domain/assignment.test.ts`
- Create: `packages/harness-engine/tests/gates/dispatch.test.ts`
- Modify: `packages/harness-engine/src/index.ts`

**Interfaces:**
- Produces `AssignmentFields { executeAs: string; delegation: string; taskCategory: string; workingBranch?: string; branchPolicy?: string; executionMode?: 'sdd' | 'inline' }`.
- Produces `parseAssignmentFields(text): Partial<AssignmentFields>` and `parseAssignmentBranchForms(text): AssignmentBranchForms`.
- Produces `validateDispatch(input): GateResult<DispatchDecision>` where input contains Assignment text, plan status, branch protection, host capability, and lease state.
- `DispatchDecision` contains only `planId`, `taskId`, `executeAs`, `branch`, `worktree`, and QC seat count; never prompt or task正文。

- [ ] **Step 1: Write the failing tests**

  Cover missing/empty `Execute as`, `Delegation`, `Task category`; the three branch forms; duplicate branch forms; default protected branch; direct-on exception with a reason; `sdd → 3` seats; `inline → 1` seat; unknown execution mode; anti-recursion when the current executor matches `executeAs`; and unknown host capability.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/domain/assignment.test.ts packages/harness-engine/tests/gates/dispatch.test.ts`

  Expected: FAIL because the parser and gate are absent.

- [ ] **Step 3: Write the minimal implementation**

  Parse only the Assignment header region and stop at the first task/body marker. Require exactly one branch form for writable work. Make protected `main`/`master` reject unless the Assignment carries an explicit direct-on reason. Map `sdd` to three QC seats and `inline` to one. Return structured violations with stable codes such as `assignment.field.missing-execute-as`, `branch.multiple-forms`, and `host.capability.unknown`.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/domain/assignment.test.ts packages/harness-engine/tests/gates/dispatch.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS; no dispatch success is possible with missing required fields.

### Task 4: Implement lease state and worktree alignment gates

**Files:**
- Create: `packages/harness-engine/src/domain/lease.ts`
- Create: `packages/harness-engine/src/gates/worktree.ts`
- Create: `packages/harness-engine/tests/domain/lease.test.ts`
- Create: `packages/harness-engine/tests/gates/worktree.test.ts`
- Modify: `packages/harness-engine/src/domain/workflow.ts`
- Modify: `packages/harness-engine/src/gates/dispatch.ts` — review fix: consume the canonical lease shape.
- Modify: `packages/harness-engine/src/adapters/json/json-artifact-store.ts` — review fix: delegate lease validation to the canonical validator.
- Modify: `packages/harness-engine/tests/gates/dispatch.test.ts` — exact lease-to-dispatch compatibility regression.
- Modify: `packages/harness-engine/tests/adapters/json-artifact-store.test.ts` — malformed canonical lease persistence regression.
- Modify: `packages/harness-engine/src/index.ts`

**Interfaces:**
- Produces `ExecutionLease { kind: 'execution'; workflowId: string; planId: string; holderId: string; worktreePath: string; fencingToken: number; claimedAt: string }`.
- Produces `IntegrationMergeLease { kind: 'integration-merge'; workflowId: string; integrationBranch: string; holderId: string; fencingToken: number; claimedAt: string }`.
- Produces `claimLease`, `releaseLease`, `canStealLease`, and `validateLease` pure functions.
- Produces `validateWorktreeAlignment(input): GateResult<WorktreeAlignment>` checking planId, branch, worktree path, owned paths, lease holder, and integration branch.

- [ ] **Step 1: Write the failing tests**

  Add tests for first claim, same-holder resume, second-holder rejection, fencing token increment, release with mismatched token, stale lease without proof, integration lease exclusivity, missing worktree, branch mismatch, owned-path overlap, and a Done row carrying an execution lease.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/domain/lease.test.ts packages/harness-engine/tests/gates/worktree.test.ts`

  Expected: FAIL because lease and alignment contracts are absent.

- [ ] **Step 3: Write the minimal implementation**

  Keep lease transitions pure and conservative. A lease can be stolen only when the caller supplies an explicit `staleProof`; otherwise return `blocked`. Use a monotonically increasing fencing token per lease key. Reject alignment if any identity, branch, path, holder, or integration anchor differs. Do not use a process-local mutex as a cross-process correctness mechanism.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/domain/lease.test.ts packages/harness-engine/tests/gates/worktree.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS, including conservative stale-lease behavior.

### Task 5: Implement SDD, QC/QA, iteration, and PR review gates

**Files:**
- Create: `packages/harness-engine/src/domain/review.ts`
- Create: `packages/harness-engine/src/gates/sdd.ts`
- Create: `packages/harness-engine/src/gates/iteration.ts`
- Create: `packages/harness-engine/src/gates/pr-review.ts`
- Create: `packages/harness-engine/tests/gates/sdd.test.ts`
- Create: `packages/harness-engine/tests/gates/iteration.test.ts`
- Create: `packages/harness-engine/tests/gates/pr-review.test.ts`
- Modify: `packages/harness-engine/src/index.ts`

**Interfaces:**
- Produces `ReviewPackage { planId: string; taskId: string; baseSha: string; headSha: string; path: string; createdAt: string }`.
- Produces `validateSddGate(input): GateResult<ReviewReady>` and refuses missing/mismatched BASE SHA, review package, planId, review range, or QC identity.
- Produces `evaluateIterationGate(input): GateResult<PhaseTransition>` for `phase-2-execute | phase-3-close | phase-4-pr-delivery`.
- Produces `evaluatePushCadence(input): GateResult<PushDecision>` and blocks when CI or AI review is running on the current head.
- Produces `evaluatePrReview(input): GateResult<MergeReady>` and invalidates prior results when `headSha` changes.

- [ ] **Step 1: Write the failing tests**

  Test missing BASE SHA, `HEAD~1` as an invalid basis, stale head, missing review package, QC seat mismatch, `sdd` tri-review, `inline` single-seat, worker_done stopping at InReview, incomplete iteration close, running CI/review push block, unresolved review block, and merge-ready invalidation after head change.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/gates/sdd.test.ts packages/harness-engine/tests/gates/iteration.test.ts packages/harness-engine/tests/gates/pr-review.test.ts`

  Expected: FAIL because review, iteration, and PR gates are absent.

- [ ] **Step 3: Write the minimal implementation**

  Make every gate accept normalized DTOs and return evidence/violations without shelling out. Treat `worker_done` as a delivery fact only; it can produce `InReview` but never `Done`. For PR review, include `baseSha` and `headSha` in every result and compare the result head with the current head before returning merge-ready. Keep tally arithmetic deterministic and separate from GitHub write permissions.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/gates/sdd.test.ts packages/harness-engine/tests/gates/iteration.test.ts packages/harness-engine/tests/gates/pr-review.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS with no gate able to infer real backend success from a weak fact.

### Task 6: Add coordination, delivery, and host ports without concrete backends

**Files:**
- Create: `packages/harness-engine/src/ports/coordination.ts`
- Create: `packages/harness-engine/src/ports/delivery.ts`
- Create: `packages/harness-engine/src/ports/host.ts`
- Modify: `packages/harness-engine/src/index.ts`
- Test: `packages/harness-engine/tests/core/result.test.ts`

**Interfaces:**
- `CoordinationAdapter.getRun/getTask/getDispatch/getWorker/getDelivery` returns allowlist DTOs with source/version/observedAt.
- `DeliveryAdapter.getIssue/getPullRequest/getChecks/getReviews/readAfterMerge` accepts explicit refs and expected head where applicable.
- `HostAdapter.probe/prepare/observe/interpret` returns capability status and evidence; it never owns workflow state.
- Capability status is `supported | degraded | unsupported | unknown`.

- [ ] **Step 1: Write the failing tests**

  Add compile-time and runtime contract fixtures proving that a DTO cannot carry prompt, transcript, credential, tool payload, or dynamic task正文 fields, and that an unimplemented host can only return `unsupported` or `unknown`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/core/result.test.ts`

  Expected: FAIL because the port types and capability helpers are absent.

- [ ] **Step 3: Write the minimal implementation**

  Define ports as dependency-inverted interfaces using plain readonly DTOs. Add a capability helper that rejects unknown status values and requires an evidence reference for `supported`. Do not add Orca/GitHub SDK dependencies and do not implement network calls in this task.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/core/result.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS with the public port contracts exported.

### Task 7: Add the thin local validation CLI and focused smoke verification

**Files:**
- Create: `packages/harness-engine/src/cli/index.ts`
- Create: `packages/harness-engine/tests/cli.test.ts`
- Modify: `packages/harness-engine/package.json`
- Modify: `packages/harness-engine/src/index.ts`

**Interfaces:**
- `harness validate <assignment-file>` prints stable violation codes and exits `1` on gate failure, `2` on usage error, `0` on pass.
- `harness status <workflow-file>` validates a versioned workflow snapshot and prints only workflow/plan/status/lease summaries.
- CLI reads files through the JSON ArtifactStore and never prints secrets or dynamic task正文.

- [ ] **Step 1: Write the failing tests**

  Add CLI tests for valid Assignment, missing-field failure, default-branch failure, malformed workflow JSON, future schema failure, status output privacy, and usage exit codes. Use temporary fixture files; do not read the user’s real harness state.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `bun test packages/harness-engine/tests/cli.test.ts`

  Expected: FAIL because the CLI entry is absent.

- [ ] **Step 3: Write the minimal implementation**

  Parse the subcommand and path before opening any artifact. Reuse the domain gates rather than reimplementing regexes in the CLI. Print one structured failure block with code, phase, evidence state, and recovery action. Keep output public-field-only and return the documented exit code.

- [ ] **Step 4: Run tests and typecheck**

  Run: `bun test packages/harness-engine/tests/cli.test.ts && bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`

  Expected: PASS for valid, invalid, privacy, and usage scenarios.

### Task 8: Verify integration boundaries and preserve existing control-plane behavior

**Files:**
- No additional source files; inspect the exact files listed above.

- [ ] **Step 1: Run the complete engine test suite**

  Run: `bun test packages/harness-engine/tests`

  Expected: PASS for core contracts, status/store, dispatch, lease/worktree, SDD/QC, iteration/PR, ports, and CLI.

- [ ] **Step 2: Run engine typecheck and the existing control-plane focused checks**

  Run: `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json && bunx tsc --noEmit -p packages/control-plane/tsconfig.json && bun test packages/control-plane/tests/domain packages/control-plane/tests/application`

  Expected: PASS; no control-plane source file is imported by the engine domain and existing configuration/launch behavior remains unchanged.

- [ ] **Step 3: Verify the public export boundary**

  Inspect `packages/harness-engine/src/index.ts` and confirm it exports core/domain/gate contracts and port types only; no JSON adapter, Orca SDK, GitHub SDK, control-plane private module, prompt, transcript, credential, or tool payload crosses the public boundary.

- [ ] **Step 4: Confirm the plan scope**

  Run: `git diff --check`

  Expected: clean whitespace check, with changes limited to the new `packages/harness-engine` package and its tests.
