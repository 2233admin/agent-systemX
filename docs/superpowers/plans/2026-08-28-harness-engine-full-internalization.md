# Harness Engine Full Internalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Harness Engine 的现有领域骨架内化为真实可执行闭环：所有本地写入经 application/use-case facade 和条件 ArtifactStore，P0 门禁确定性闭合，Orca/GitHub/Host 受控合同与真实回读分层，control-plane OMP/Claude 无回归，Epic 5.6–5.8 全部有等价本地能力，最终以六个外部硬门决定 Verified/merge-ready。

**Architecture:** 维持独立 TypeScript/Bun 六边形模块化单体，固定依赖方向 `cli → application → domain`、`adapters → ports`。领域内核不依赖 Bun、SQLite、文件系统、Orca、GitHub 或 control-plane 内部实现；应用层拥有状态变更和授权写入，外部后端只通过明确 DTO 和 typed ports 提供证据。

**Tech Stack:** TypeScript、Bun、Bun test、`bunx tsc --noEmit`、版本化 JSON ArtifactStore、注入式 typed adapters、PowerShell Windows-safe commands、GitHub Actions。

**Spec:** `_bmad-output/specs/spec-harness-engine/SPEC.md`；`_bmad-output/specs/spec-harness-engine/validation-contract.md`；`_bmad-output/planning-artifacts/architecture/architecture-harness-engine/ARCHITECTURE-SPINE.md`；Epic 5 in `_bmad-output/planning-artifacts/epics.md`。

## Global Constraints

- 领域内核保持 IO-free；不得导入 Bun、SQLite、文件系统、环境变量、Orca、GitHub、control-plane 内部 domain/repository。
- `packages/control-plane` 继续拥有配置修订、AssemblyManifest、OMP/Claude 装配和安全启动；Harness Engine 只通过其真实公开入口和新建的明确 typed facade 使用这些能力，不共享内部 SQLite/domain。
- Workflow/Plan/Gate/Lease/Residual 的唯一 SSOT 是受控 ArtifactStore；Run/Task/Dispatch/Worker/Delivery 的 SSOT 是 Orca；Issue/PR/checks/review/merge 的 SSOT 是 GitHub。
- 任何写入必须绑定 expected revision/head；任何无法证明的事实必须是 `fail | blocked | unknown`，不得用空数组、`false`、缺字段或退出码零伪装成功。
- Assignment 必须有 `Execute as`、`Delegation`、`Task category` 和唯一 branch form；默认保护分支需显式 direct-on 理由；leaf 不得递归派发同角色。
- execution lease 按 `workflowId + planId + worktreePath` 唯一；integration merge lease 按 `workflowId + integrationBranch` 唯一；stale 无法证明时不得强抢。
- `worker_done` 最多推动至 `InReview`；Done 必须具备任务回收、BASE..HEAD review package、QC/QA、residual closure、lease 释放和交付证据。
- `sdd` 使用三席 QC，`inline` 才使用一席；QC/QA 必须共享 planId、review range、diff basis。
- Orca/GitHub/Host adapters 只输出 allowlist DTO，不传播 prompt、transcript、任务正文、工具 payload、credentials 或未脱敏 stderr。
- OMP/Claude 只接现有 control-plane 真实 facade；Codex/OpenCode 只能输出有证据的 `unsupported | unknown`；Cursor/Kimi/ZCode 不声明首轮支持。
- 不建设 daemon、常驻轮询、自动重派、自动唤醒、第三实时源、跨宿主配置等价、Session 内容复制或新的实时协调服务。
- ownership 文档不是 runtime lock；runtime lock 必须由应用层真实 lease/fencing 强制。
- 不把 BMad/Epic/Story/sprint-status 的 `Done` 当代码、测试、real smoke、Verified 或 active 证据；fake/fixture/controlled 也不得填充 real-smoke 分母。
- real Orca/GitHub smoke 只使用自然存在对象；默认只读；仓库不保存 credentials、外部正文、额外任务、PR、worktree 或 lease。
- 每个 stage 只提交自身文件；禁止 destructive git 命令、强制 reset、清理他人 WIP、删除旧工具、重写 control-plane 数据库。

## Cross-cutting canonical contracts

本节是 Stage 0–7 共用的合同层。后续 Stage 不得重新定义同名字段、状态或关联键；若实现发现现有接口与本节冲突，必须先更新本节及受影响的 task，再写代码。本文中的 `Unknown` 是可证明的不可观察事实，`not-available` 是真实 smoke 前置条件缺失；二者都不能升级为 `pass`。

### Contract 1: Canonical artifact schema and serialization

**Canonical schema:**

```ts
export interface CanonicalArtifactEnvelope {
  readonly schemaVersion: 1;
  readonly artifactKind: 'workflow' | 'evidence' | 'gate' | 'validation-decision';
  readonly workflowId: string;
  readonly revision: number;
  readonly canonicalHash: string;
  readonly value: unknown;
  readonly observedAt: string;
}
```

- `schemaVersion` 是整数且只允许已实现的版本；未知未来版本必须 fail closed，不得静默降级。
- `canonicalHash` 对去除 `canonicalHash` 字段后的 canonical JSON 计算；对象键按 UTF-16 code unit 排序，数组保持语义顺序，字符串使用 UTF-8，时间统一 RFC 3339，禁止依赖平台默认序列化。
- `canonicalHash` 必须覆盖 `artifactKind`、`workflowId`、`revision`、`value` 和 `observedAt`；不得把动态 stderr、凭据、prompt、transcript 或任务正文放进 `value`。
- compatibility 只允许显式 `schemaVersion` 迁移；不能把未来字段猜测成当前字段。迁移必须产生 `sourceDigest`、`targetDigest`、`migrated` 和 evidence。
- ArtifactStore 的条件写入比较 `expectedRevision`；成功后 revision 单调递增，stale revision 返回结构化 conflict，不覆盖已有 artifact。

**Files / tests / commands:**

- Files: Stage 1 `src/ports/artifacts.ts`、`src/adapters/json/json-artifact-store.ts`; Stage 6A `src/artifacts/status-schema.ts`、`src/artifacts/migration.ts`.
- Tests: `tests/adapters/json-artifact-store.test.ts`; Stage 1 `tests/application/direct-write-bypass.test.ts`; Stage 6A `tests/artifacts/{schema,migration}.test.ts`.
- Commands: Stage 1 task `:148-158,207-232`; Stage 6A task `:576-606`.

### Contract 2: Typed WorkflowFacade commands

所有 Facade command 使用同一个 envelope；command 不接收任务正文或客户端私有 payload。

```ts
export interface WorkflowCommandEnvelope {
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly inputDigest: string;
}

export type WorkflowCommandResult<T> =
  | {
      readonly kind: 'applied';
      readonly value: T;
      readonly revision: number;
      readonly operationId: string;
      readonly evidenceRefs: readonly EvidenceRef[];
    }
  | {
      readonly kind: 'rejected' | 'blocked' | 'unknown' | 'not-available';
      readonly revision: number;
      readonly operationId: string;
      readonly violations: readonly Violation[];
      readonly recoveryActions: readonly RecoveryAction[];
      readonly evidenceRefs: readonly EvidenceRef[];
    };
```

Facade commands and required fields:

| Command | Required input | Successful output |
| --- | --- | --- |
| `createWorkflow` | envelope without `planId`, workflow metadata digest | revision-1 `WorkflowSnapshot` |
| `registerPlan` | envelope + plan id/title/baseSha | updated snapshot with `Todo` plan |
| `registerAssignment` | envelope + plan/task + executeAs/delegation/taskCategory/branch form | updated snapshot with validated assignment |
| `prepareExecution` | envelope + plan/task + branch/worktree/host facts | prepared result or `blocked/unknown` |
| `claimExecutionLease` | envelope + worktree path | updated snapshot with unique lease/fencing token |
| `transitionPlan` | envelope + target status + completion evidence when target is `Done` | updated snapshot or typed rejection |
| `appendEvidence` | envelope + typed evidence refs | updated snapshot with monotonic revision |
| `releaseExecutionLease` | envelope + lease identity/fencing token | updated snapshot without lease |
| `status` / `validate` | envelope with read-only expected revision | `StatusView` / `ValidationView`; no write |

Rules:

- same `idempotencyKey` + same `inputDigest` returns the original result without a second write;
- same key with a different digest is `rejected` and never writes;
- expected revision mismatch is `blocked` with a conflict violation;
- external calls and local ArtifactStore writes are not atomic; every partial failure returns a durable non-success result and a concrete reconcile action;
- `Done` requires task recovery, BASE..HEAD review package, QC/QA, residual closure, released leases and delivery evidence;
- Facade coordinates existing domain/gates but does not define a second state machine.

**Files / tests / commands:**

- Files: Stage 1 `src/application/{harness-application,commands,queries,identity}.ts`; `src/ports/artifacts.ts`; `src/cli/index.ts`.
- Tests: Stage 1 `tests/application/{harness-application,identity,direct-write-bypass}.test.ts`; existing `tests/domain/workflow.test.ts` and `tests/domain/lease.test.ts`.
- Commands: Stage 1 task `:144-232`; Stage 2 completion task `:246-269`.

### Contract 3: Adapter correlation and error union

```ts
export interface AdapterCorrelationEnvelope {
  readonly workflowId: string;
  readonly planId: string;
  readonly operationId: string;
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface AdapterRequestCorrelation extends AdapterCorrelationEnvelope {
  readonly requestId: string;
}

export interface AdapterEventCorrelation extends AdapterCorrelationEnvelope {
  readonly eventId: string;
  readonly sequence: number;
}

export type AdapterError =
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string }
  | { readonly kind: 'timeout'; readonly code: string; readonly timeoutMs: number }
  | { readonly kind: 'permission-denied'; readonly code: string }
  | { readonly kind: 'identity-mismatch'; readonly code: string }
  | { readonly kind: 'shape-invalid'; readonly code: string }
  | { readonly kind: 'stale'; readonly code: string }
  | { readonly kind: 'transport'; readonly code: string };
```

- Every adapter request, response, observation and evidence record carries the same `operationId + snapshotId`; request/event identifiers are unique within the operation.
- A response with a mismatched workflow/plan/run/task/dispatch/head identity is `identity-mismatch`, never a successful empty result.
- Retries create a new `attemptId` but preserve `operationId`; duplicate `requestId`/`eventId` is idempotently ignored or reported as duplicate, never appended twice.
- Raw backend payloads are parsed at the adapter boundary and never cross into domain or ArtifactStore.

**Files / tests / commands:**

- Files: Stage 3 `src/ports/{coordination,delivery,host}.ts`; `src/adapters/{orca,github,hosts}/**`.
- Tests: `tests/adapters/{orca,github,host,contract-fixtures}.test.ts`; Stage 4 smoke tests.
- Commands: Stage 3 task `:289-349`; Stage 4 task `:351-426`.

### Contract 4: Windows-local path, process, file-lock and encoding rules

- Paths are normalized to absolute paths with `/` separators only for canonical comparison; containment is checked against the configured repo/artifact root before every read/write.
- Drive-letter case is normalized for comparison; UNC paths, spaces, non-ASCII names and long paths are valid inputs when the host can access them; path escape is invalid.
- Files are UTF-8; generated JSON uses LF and a final newline; readers accept CRLF; hashes are over normalized UTF-8 bytes.
- Artifact writes use same-directory temporary files and atomic replace; a write must fail closed if the destination is locked or replacement cannot be proven.
- External processes receive argv arrays, never shell strings; timeout, non-zero exit, signal termination and malformed output map to typed errors; stderr is bounded and redacted.
- PowerShell commands validate required environment variables before copying them, set `$env:HARNESS_REAL_WRITE = '0'` for default smoke, and never use POSIX assignment syntax.
- Windows smoke and local artifact tests must not create external objects or modify user/global configuration.

**Files / tests / commands:**

- Files: Stage 1 `src/adapters/json/json-artifact-store.ts`; Stage 3 adapters; Stage 4 smoke/evidence handlers; Stage 6A artifact commands.
- Tests: `tests/adapters/json-artifact-store.test.ts`; Stage 4 `tests/smoke/**`; Stage 6A path/migration tests.
- Commands: Stage 4 `:382-426`; Stage 6A `:589-606`; Stage 6B `:627-643`; Stage 6C `:659-680`.

### Contract 5: HardGateRecord and ValidationDecision

```ts
export interface HardGateRecord {
  readonly gateId: 'code-tests' | 'failure-ledger' | 'ownership' | 'independent-review' | 'controlled-integration' | 'real-smoke';
  readonly state: 'pass' | 'fail' | 'blocked' | 'unknown' | 'not-available';
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly failureRefs: readonly EvidenceRef[];
  readonly owner: string;
  readonly observedAt: string;
  readonly recoveryAction?: RecoveryAction;
}

export interface ValidationDecision {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly state: 'Partial' | 'Draft' | 'Blocked' | 'Unknown' | 'Verified';
  readonly gates: readonly [HardGateRecord, HardGateRecord, HardGateRecord, HardGateRecord, HardGateRecord, HardGateRecord];
  readonly evidenceManifestHash: string;
  readonly observedAt: string;
}
```

- `gates` must contain exactly one record for each of the six `gateId` values.
- Every gate record must bind to the same current head and source hash as the bundle; evidence must be typed, non-empty and current.
- `state: pass` requires `failureRefs.length === 0`; any unresolved current failure blocks the corresponding gate.
- `real-smoke` denominator includes only current natural-object Orca/GitHub readback and declared-host real probe/smoke records. Fake, fixture, controlled-integration, static docs, help output, exit code 0 and `not-available` are excluded from the pass denominator.
- `not-available` remains explicit and non-passing; it yields a non-`Verified` ValidationDecision.
- `Verified` requires all six gates `pass` and both required Orca/GitHub real-smoke records `pass`; missing host prerequisites cannot be promoted.

**Files / tests / commands:**

- Files: Stage 0 `src/validation/failure-ledger.ts`; Stage 5 `src/validation/host-ci-evidence.ts`; Stage 7 `src/validation/{hard-gates,validation-decision,independent-review}.ts`.
- Tests: Stage 0 failure-ledger tests; Stage 5 host evidence tests; Stage 7 hard-gate/decision tests.
- Commands: Stage 0 `:118-140`; Stage 5 `:530-568`; Stage 7 `:760-817`.

### Cross-cutting implementation gate

- [ ] Before Stage 1 code, add the shared type definitions or equivalent concrete files above and make Stage 1–7 reference them rather than redeclare fields.
- [ ] Before Stage 3 adapters, add correlation and error-union contract tests for identity mismatch, timeout, duplicate request/event, stale response and malformed shape.
- [ ] Before Stage 4 smoke, add Windows path/process/file-lock/encoding tests and verify every smoke command has a missing-prerequisite `not-available` branch.
- [ ] Before Stage 7 acceptance, validate exactly six `HardGateRecord` entries, same head/hash, typed evidence, no pass with failureRefs, and no `Verified` with any `not-available`.

These four checks are cross-cutting prerequisites, not a new implementation stage; they amend the existing Stage 0–7 tasks and preserve their commit boundaries.

## Current Facts Inventory

- `SPEC.md`、`validation-contract.md`、`ARCHITECTURE-SPINE.md` 已定义最小事实、边界、证据等级、六硬门和 non-goals；它们是范围依据而非实现证据。
- Epic 5 Story 5.1–5.8 在 `sprint-status.yaml` 中为 `backlog`；该字段只表示排程。
- 已有 `packages/harness-engine/src/core/{result,ids}.ts`、`src/domain/{assignment,workflow,lease,review}.ts`、`src/gates/{dispatch,worktree,sdd,iteration,pr-review}.ts`、`src/ports/{artifacts,coordination,delivery,host}.ts`、`src/adapters/json/json-artifact-store.ts`、`src/cli/index.ts`。
- 已有测试为 `tests/core/result.test.ts`、`tests/domain/{assignment,workflow,lease}.test.ts`、`tests/gates/{dispatch,worktree,sdd,iteration,pr-review}.test.ts`、`tests/adapters/json-artifact-store.test.ts`、`tests/cli.test.ts`；全部先 reconcile，不能写成空白 scaffold。
- 当前 `src/cli/index.ts` 直接构造 JsonArtifactStore，并注入 synthetic defaults、host capability 和 lease；这是 Stage 1 必须消除的 bypass/default 路径。
- 当前 control-plane grep 未发现 `getConfigRevision`、`getAssemblyManifest`、`probeClient`、`prepareLaunchFacade` 这些方法；Stage 5 必须从实际 `packages/control-plane/src/application/ports.ts` 和实际公开入口提取/定义真实 typed facade，不能假设它们已经存在。

### 旧能力等价映射

| 旧资产 | 只取行为/失败语义 | 新归属 |
| --- | --- | --- |
| `tools/dispatch_liveness/`、`tools/dispatch_deadlines/` | accepted、执行中、超时、失联、保守失败 | `dispatch`/`iteration` gates |
| `tools/worktree-gc/` | worktree alignment、孤儿/冲突、lease 释放条件 | `worktree` gate/application lease |
| `tools/worker_snapshot/` | workflow snapshot、delivery 缺失、failure ledger 线索 | Workflow/CompletionEvidence/failure ledger |
| `tools/plugin_release/`、`tools/skill_registry/` | 资产、来源、版本、发布验证 | 后置 Stage 6 的质量/发布/知识能力 |
| 旧 Orca/GitHub 工具研究 | ID 关联、head readback、跨 Run、重复、失联、权限未知 | typed adapters/readback |
| control-plane | 现有公开 application ports/入口的配置与 host 能力 | Stage 5 明确 typed facade；不共享内部 SQLite/domain |

## Dependency Graph

```text
Stage 0 current-head baseline + ownership + failure closure
  └─> Stage 1 guarded application write path + CLI cutover
        └─> Stage 2 local P0 gates + ownership inventory + PlanCompletion
              └─> Stage 3 controlled Orca/GitHub/Host adapters
                    └─> Stage 4 Windows-safe real readback (read-only default)
Stage 1 + Stage 3
  └─> Stage 5 actual control-plane typed facade + host smoke + CI
Stage 2 + Stage 3 + Stage 4 + Stage 5
  └─> Stage 6 full 5.6–5.8 internalization
Stage 0–6
  └─> Stage 7 independent review + six-hard-gate external acceptance/merge-ready
```

## Stage 0: 基线、ownership 与 failure closure

**Files:**

- Create: `docs/superpowers/evidence/harness-engine/2026-08-28-baseline/failure-ledger.json`
- Create: `docs/superpowers/evidence/harness-engine/2026-08-28-baseline/ownership.json`
- Create: `docs/superpowers/evidence/harness-engine/2026-08-28-baseline/commands.json`
- Create: `packages/harness-engine/src/validation/failure-ledger.ts`
- Create: `packages/harness-engine/tests/validation/failure-ledger.test.ts`

**Interfaces:**

```ts
export interface RerunResult {
  readonly suiteCommand: string;
  readonly exitCode: number;
  readonly firstError?: string;
  readonly observedAt: string;
}

export interface FailureLedgerRow {
  readonly id: string;
  readonly suiteCommand: string;
  readonly suiteExitCode: number;
  readonly firstError: string;
  readonly contractRef: string;
  readonly owner: string;
  readonly rerunCommand: string;
  readonly rerunResult: RerunResult | null;
  readonly closureEvidence: readonly string[];
}

export type FailureLedger =
  | { readonly status: 'zero-failures'; readonly failures: readonly [] }
  | { readonly status: 'current-failures'; readonly failures: readonly [FailureLedgerRow, ...FailureLedgerRow[]] };

export function validateFailureLedger(value: unknown): FailureLedger;

export interface OwnershipRecord {
  readonly currentHead: string;
  readonly branch: string;
  readonly worktree: string;
  readonly ownedPaths: readonly string[];
  readonly attributedDirtyPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly conflictingPaths: readonly string[];
  readonly implementer: string;
  readonly observedAt: string;
}
```

**TDD/evidence steps:**

- [ ] Step 1: Capture `git status --short --branch`, current head, worktree and all changed/untracked paths; assign each path to this task, another WIP, or a named block.
- [ ] Step 2: Run `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` and the current Harness focused suite; write exact commands, exit codes and first errors.
- [ ] Step 3: Implement `validateFailureLedger`: zero failures must be exactly `status: zero-failures` with an empty tuple; current failures must be non-empty and every row must physically contain both `rerunResult` and `closureEvidence` fields, with at least one populated (`rerunResult !== null` or `closureEvidence.length > 0`). Owner and rerun command are always required.
- [ ] Step 4: Add tests for zero-row ledger, current failure with rerun, current failure with closure evidence, both fields absent, both fields empty, missing owner, stale-only row and duplicate IDs.
- [ ] Step 5: Re-run every current failure using its recorded rerun command; unresolved rows remain current and block the stage. Confirm concurrent WIP has no conflicting owned paths.

**Commands / expected output:**

```text
bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
Expected: exit 0 or every failure is in current-failures with owner, rerunResult/closureEvidence and rerunCommand.

bun test packages/harness-engine/tests/validation/failure-ledger.test.ts packages/harness-engine/tests/cli.test.ts packages/harness-engine/tests/adapters/json-artifact-store.test.ts
Expected: validator tests pass; zero-failure ledger is a distinct valid shape; incomplete current rows are rejected.
```

**Commit boundary:** `chore(harness): record current-head baseline and failure closure contract`。

**Rollback:** 只撤销 Stage 0 evidence/validator；不改运行时代码、其他 WIP 或外部状态。

**Exit conditions:** current head、ownership、dirty attribution 和 failure closure 可回读；零失败使用 zero-row shape；当前失败不能缺 rerunResult/closureEvidence。

**Stop conditions:** 未归属路径、当前失败未重跑、缺 owner、缺 rerun/closure、旧快照代替当前记录或 WIP overlap。

## Stage 1: Runtime guarded write path 与 CLI cutover

**Files:**

- Modify: `packages/harness-engine/src/ports/artifacts.ts` — retain `readWorkflow` and conditional write while adding application authorization context。
- Modify: `packages/harness-engine/src/adapters/json/json-artifact-store.ts` — validate schema/revision, atomic write, authorization and stale-write rejection；raw writer 收窄为 application factory 私有能力。
- Create: `packages/harness-engine/src/application/harness-application.ts`。
- Create: `packages/harness-engine/src/application/commands.ts`。
- Create: `packages/harness-engine/src/application/queries.ts`。
- Create: `packages/harness-engine/src/application/identity.ts` — file input 到 identity/authorization 的纯映射。
- Modify: `packages/harness-engine/src/cli/index.ts` — 删除 direct `new JsonArtifactStore`、synthetic defaults、synthetic host capability、synthetic lease；全部调用 application factory。
- Modify: `packages/harness-engine/src/index.ts` — 不再 public export raw JsonArtifactStore constructor。
- Modify: `packages/harness-engine/src/domain/{workflow,lease,review}.ts` only for required invariants。
- Modify: `packages/harness-engine/tests/{cli.test.ts,adapters/json-artifact-store.test.ts}`。
- Create: `packages/harness-engine/tests/application/harness-application.test.ts`、`identity.test.ts`、`direct-write-bypass.test.ts`。

**Interfaces:**

```ts
export interface FileInput {
  readonly artifactRoot: string;
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly actorId: string;
  readonly expectedRevision?: number;
  readonly inputDigest: string;
}

export interface ApplicationIdentity {
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly actorId: string;
  readonly sourcePath: string;
  readonly inputDigest: string;
}

export interface ApplicationWriteAuthorization {
  readonly kind: 'harness-application-write';
  readonly applicationId: string;
  readonly nonce: string;
}

export interface GuardedArtifactStore {
  readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null>;
  writeWorkflow(expectedRevision: number, next: WorkflowSnapshot, authorization: ApplicationWriteAuthorization): Promise<void>;
}

export interface HarnessApplication {
  createWorkflow(input: CreateWorkflowCommand): Promise<WorkflowSnapshot>;
  readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null>;
  registerPlan(input: RegisterPlanCommand): Promise<WorkflowSnapshot>;
  registerAssignment(input: RegisterAssignmentCommand): Promise<WorkflowSnapshot>;
  transitionPlan(input: TransitionPlanCommand): Promise<WorkflowSnapshot>;
  claimExecutionLease(input: ClaimExecutionLeaseCommand): Promise<WorkflowSnapshot>;
  releaseExecutionLease(input: ReleaseExecutionLeaseCommand): Promise<WorkflowSnapshot>;
  appendCompletionEvidence(input: AppendCompletionEvidenceCommand): Promise<WorkflowSnapshot>;
  status(input: StatusQuery): Promise<StatusView>;
  validate(input: ValidateQuery): Promise<ValidationView>;
}
```

**TDD steps:**

- [ ] Step 1: Add failing identity tests proving `FileInput` resolves to `ApplicationIdentity` from path, explicit IDs, actor and digest; task正文 never enters identity or artifact.
- [ ] Step 2: Add failing tests for every current ArtifactStore caller/factory: CLI construction, JSON adapter tests, application factory and public exports. Expected result: no production caller can construct the raw writer or inject synthetic defaults.
- [ ] Step 3: Add direct-construction negative tests: direct `new JsonArtifactStore`/raw factory is unavailable outside its module; missing authorization, wrong applicationId, stale revision, schema mismatch and malformed lease make zero writes.
- [ ] Step 4: Add Done-snapshot and invalid-transition negatives: Done without CompletionEvidence/lease release/review/QA fails; `Todo → Done`, `Done → InProgress`, duplicate lease claim and worker_done → Done fail with stable codes.
- [ ] Step 5: Implement application factory, guarded store and CLI migration. Real host capability, branch/worktree and lease facts must be explicit command inputs or Unknown; no synthetic default can be manufactured by CLI.
- [ ] Step 6: Run all affected Harness tests and typecheck; inspect import/export graph to confirm raw JsonArtifactStore is not public.

**Commands / expected output:**

```text
bun test packages/harness-engine/tests/application packages/harness-engine/tests/cli.test.ts packages/harness-engine/tests/adapters/json-artifact-store.test.ts
Expected: application/CLI/adapter tests pass; direct construction, invalid transition and invalid Done snapshot all fail closed.

bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
Expected: exit 0，无 diagnostics；无 caller 依赖 raw JsonArtifactStore constructor。
```

**Commit boundary:** `feat(harness): route every artifact mutation through guarded application`。

**Rollback:** 只撤销 Stage 1；保留 Stage 0 ledger。不得恢复 synthetic defaults 或 raw public writer；如需恢复只恢复接口兼容，不恢复 bypass。

**Exit conditions:** 所有 caller/factory 已迁移；CLI file input 映射到 identity/authorization；raw writer 非 public；direct-write/Done/invalid-transition negatives 通过。

**Stop conditions:** CLI 可构造 raw store、缺 lease/host capability 仍能成功写、无 expected revision 写入、或 synthetic default 掩盖 Unknown。

## Stage 2: Local P0 gates 与 gate ownership inventory

**Files:**

- Create first: `packages/harness-engine/docs/gate-ownership.json` — inventory table mapping each requirement to existing owner/test.
- Modify: existing owners only: `src/core/{result,ids}.ts`、`src/domain/{assignment,workflow,lease,review}.ts`、`src/gates/{dispatch,worktree,sdd,iteration,pr-review}.ts`。
- Create a new `src/gates/{path,status,qa}.ts` only when `gate-ownership.json` proves no current owner exists; never create duplicate assignment/workflow/lease/dispatch/worktree/sdd/iteration/pr-review modules.
- Modify all existing domain/gate/core tests and create `tests/gates/p0-samples.test.ts`。

**Interfaces:**

```ts
export interface PlanCompletion {
  readonly workflowId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly reviewPackage: ReviewPackage;
  readonly qc: QcIdentity;
  readonly qaEvidence: readonly EvidenceRef[];
  readonly residualClosure: ResidualClosure;
  readonly executionLeaseReleased: true;
  readonly integrationMergeLeaseReleased: true;
  readonly deliveryEvidence: readonly EvidenceRef[];
}
```

**TDD steps:**

- [ ] Step 1: Inventory current gate functions/tests in `gate-ownership.json`; record owner, input, output, existing tests and missing contract. The inventory is a planning artifact, not a runtime lock.
- [ ] Step 2: Freeze existing result/code ordering as golden outputs; add five samples per path/status/workflow/assignment/dispatch category.
- [ ] Step 3: Add five samples per lease/worktree/SDD/QC/QA category, including second writer, uncertain stale, overlap, missing BASE, wrong range/identity/seats and missing closure.
- [ ] Step 4: Add five samples per iteration/PR category, including phase order, current-head busy, head drift, missing checks/reviews and invalidated merge-ready.
- [ ] Step 5: Reconcile only the existing owner modules; every failure has stable violation/recovery, Unknown has reason/time, and PlanCompletion is required for Done.
- [ ] Step 6: Run every sample twice and compare serialized outputs; run all current tests.

**Commands / expected output:**

```text
bun test packages/harness-engine/tests/core packages/harness-engine/tests/domain packages/harness-engine/tests/gates
Expected: existing and P0 sample suites pass; inventory has exactly one owner for each named gate.

bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
Expected: exit 0。
```

**Commit boundary:** `feat(harness): close local P0 gates with explicit ownership and PlanCompletion`。

**Rollback:** 只撤销 gate reconciliation；保留 Stage 1 application and Stage 2 inventory for diagnosis，不能以新增重复模块替代回滚。

**Exit conditions:** path/status/workflow/assignment/dispatch/lease/worktree/SDD/QC/QA/iteration/PR review 全部闭合；每类五样本；无重复 owner。

**Stop conditions:** 缺证据仍 pass、Unknown 被 boolean 替代、stale head 仍有效、或未先 inventory 就新增同义 gate。

## Stage 3: Controlled Orca/GitHub/Host adapters

**Files:**

- Modify: `packages/harness-engine/src/ports/{coordination,delivery,host}.ts`。
- Create: `src/adapters/orca/orca-adapter.ts`、`src/adapters/github/github-adapter.ts`。
- Create: `src/adapters/hosts/{omp,claude,codex,opencode}/*-host-adapter.ts`。
- Create sanitized fixtures under `tests/fixtures/{orca,github,hosts}`。
- Create adapter tests under `tests/adapters/{orca,github,host,contract-fixtures}.test.ts`。

**Interfaces:**

```ts
export interface ControlledTransport<TRequest, TResponse> {
  readonly source: string;
  readonly version: string;
  request(input: TRequest): Promise<TResponse>;
}

export interface OrcaObservationInput {
  readonly runId: string;
  readonly taskId: string;
  readonly dispatchId: string;
  readonly workerId: string;
  readonly deliveryId: string;
}

export interface GithubReadbackContext {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly expectedHead: string;
}
```

**TDD steps:**

- [ ] Step 1: Shared DTO tests reject dynamic fields, missing evidence/version/time and unbound identity.
- [ ] Step 2: Orca fixtures cover normal five-object association, cross Run, duplicate delivery, accepted-not-executed and disconnected/missing responses; adapter never dispatches, awakens or reassigns.
- [ ] Step 3: GitHub fixtures cover current head/check/review, head drift, permission failure, response-shape failure and expected-head write/readback ordering.
- [ ] Step 4: Host fixtures cover OMP/Claude evidence-backed capability and Codex/OpenCode unsupported/unknown.
- [ ] Step 5: Implement mapping around injected transports; controlled reports are labeled controlled-integration and never real smoke.
- [ ] Step 6: Run twice and compare serialized outputs.

**Commands / expected output:**

```text
bun test packages/harness-engine/tests/adapters packages/harness-engine/tests/fixtures/contract-fixtures.test.ts
Expected: all controlled contracts pass; every required negative has deterministic fail/blocked/unknown result。

bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
Expected: exit 0。
```

**Commit boundary:** `feat(harness): add controlled Orca GitHub and host adapters`。

**Rollback:** 只撤销 Stage 3 adapters/fixtures；保留 Stage 2 gates/application。泄露内容的 fixture 删除后按 allowlist DTO 重建，不触碰外部对象。

**Exit conditions:** typed ports/adapters 完成；controlled 与 real evidence 明确分离；所有跨 Run/duplicate/disconnected/accepted-not-executed/head drift/permission/shape cases 有测试。

**Stop conditions:** fixture 进入 real denominator、raw payload 越过 port、adapter 自动扩大写入或 unsupported host 返回 success。

## Stage 4: Windows-safe real Orca/GitHub readback

**Files:**

- Create: `packages/harness-engine/tests/smoke/orca-readback.smoke.test.ts`。
- Create: `packages/harness-engine/tests/smoke/github-readback.smoke.test.ts`。
- Create: `packages/harness-engine/tests/smoke/smoke-evidence.ts`。
- Modify only for observed contract mismatch: Stage 3 Orca/GitHub adapters。
- Create: `packages/harness-engine/src/cli/parsers/smoke-evidence-command.ts` and `packages/harness-engine/src/cli/commands/smoke-evidence-command.ts`; modify `packages/harness-engine/src/cli/index.ts` dispatch so every missing-prerequisite branch has a real evidence-writing handler.
- Create: `packages/harness-engine/tests/cli/smoke-evidence-command.test.ts`.
- Create during execution only: redacted `docs/superpowers/evidence/harness-engine/2026-08-28-real-smoke/{orca,github}.json`。

**Interfaces:**

```ts
export interface RealSmokeEvidence {
  readonly backend: 'orca' | 'github';
  readonly adapterVersion: string;
  readonly observedAt: string;
  readonly objectRefs: readonly string[];
  readonly permission: 'read-only' | 'bounded-write' | 'denied' | 'unknown';
  readonly network: 'reachable' | 'unreachable' | 'unknown';
  readonly expectedHead?: string;
  readonly readbackRefs: readonly string[];
  readonly result: 'pass' | 'blocked' | 'unknown' | 'not-available';
}
```

**TDD/smoke steps:**

- [ ] Step 1: Missing natural IDs, credentials or network prerequisites produce `not-available` evidence and a blocked acceptance state; tests never substitute controlled fixtures.
- [ ] Step 2: Default real smoke is read-only and explicitly sets `$env:HARNESS_REAL_WRITE = '0'`. PowerShell validates all harness variables before copying them; it never uses POSIX assignment syntax:

```powershell
$env:HARNESS_REAL_WRITE = '0'
$names = @('HARNESS_ORCA_RUN_ID','HARNESS_ORCA_TASK_ID','HARNESS_ORCA_DISPATCH_ID','HARNESS_ORCA_WORKER_ID','HARNESS_ORCA_DELIVERY_ID')
$missing = @($names | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend orca --result not-available --missing ($missing -join ',')
  exit 0
}
$env:ORCA_RUN_ID = $env:HARNESS_ORCA_RUN_ID
$env:ORCA_TASK_ID = $env:HARNESS_ORCA_TASK_ID
$env:ORCA_DISPATCH_ID = $env:HARNESS_ORCA_DISPATCH_ID
$env:ORCA_WORKER_ID = $env:HARNESS_ORCA_WORKER_ID
$env:ORCA_DELIVERY_ID = $env:HARNESS_ORCA_DELIVERY_ID
bun test packages/harness-engine/tests/smoke/orca-readback.smoke.test.ts
```

Expected: all five harness variables are non-empty before the real call; otherwise evidence writer records `result=not-available` and no Orca call runs.
- [ ] Step 3: GitHub PowerShell validates all required harness variables before copying them:

```powershell
$env:HARNESS_REAL_WRITE = '0'
$names = @('HARNESS_GITHUB_OWNER','HARNESS_GITHUB_REPOSITORY','HARNESS_GITHUB_PR_NUMBER')
$missing = @($names | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend github --result not-available --missing ($missing -join ',')
  exit 0
}
$env:GITHUB_OWNER = $env:HARNESS_GITHUB_OWNER
$env:GITHUB_REPOSITORY = $env:HARNESS_GITHUB_REPOSITORY
$env:GITHUB_PR_NUMBER = $env:HARNESS_GITHUB_PR_NUMBER
bun test packages/harness-engine/tests/smoke/github-readback.smoke.test.ts
```

- [ ] Step 4: Real smoke is strictly read-only. Set `$env:HARNESS_REAL_WRITE = '0'` before every command and assert the adapter has no mutation method enabled. GitHub write-after-readback is excluded from this plan and remains a blocked gate requiring a separate owner-approved write plan; this plan records only the missing write evidence as `not-available`.
- [ ] Step 5: Fresh process checks evidence redaction. A missing safe natural operation records `permission: read-only`, `result: not-available`; it is not converted to pass.

**Commit boundary:** smoke code/schema first；redacted current evidence only after review，message `test(harness): record real Orca and GitHub readback evidence`。不提交 env/credentials/raw payload。

**Rollback:** 停止写分支，撤销 adapter fix/smoke harness；保留 failing evidence/ledger。head drift、permission 或 network failure 不扩大重试。

**Exit conditions:** default smoke is Windows-copyable and read-only；真实对象/readback evidence 当前可审查；write-after-readback remains an explicitly blocked separate-plan gate；not-available is explicit and non-passing。

**Stop conditions:** 需要 POSIX env syntax、需要造对象、需要默认写入、head/permission/shape unknown 或需扩大写权限。

## Stage 5: Actual control-plane typed facade、Host smoke 与 CI

**Files:**

- Modify: `packages/control-plane/src/application/ports.ts` — keep the existing repository/writer/search/launch port interfaces unchanged and add the concrete Harness DTOs plus `ExistingPublicApplicationPorts` mapping type defined below; current ports.ts is type/interface-only.
- Create: `packages/control-plane/src/application/public-entry.ts` — the actual public application entry because this package has no `src/index.ts`; export `createHarnessControlPlaneFacade` and its concrete DTOs from this file.
- Modify: `packages/control-plane/src/cli/index.ts` — migrate existing `configs` command callers (`show`, `compare`, `status`, `use`, `switch`, `establish`, `revise`, `supply`) to consume the public-entry facade where host/config facts are needed; retain CLI rendering and command behavior.
- Create: `packages/control-plane/src/application/harness-facade.ts` — implement `createHarnessControlPlaneFacade` by composing the existing `ConfigRevisionRepository`, `ConfigRevisionWriter`, `ConfigSearchPort` and current launch application ports; no SQLite repository import in Harness Engine.
- Create: `packages/harness-engine/src/application/control-plane-port.ts` — matching concrete typed consumer interface.
- Modify: `packages/harness-engine/src/adapters/hosts/omp/omp-host-adapter.ts` and `claude/claude-host-adapter.ts` — call the four typed facade functions and map DTOs to HostCapabilityEvidence.
- Modify: `packages/harness-engine/src/adapters/hosts/codex/codex-host-adapter.ts` and `opencode/opencode-host-adapter.ts` — return typed unsupported/unknown results.
- Create: `packages/harness-engine/src/cli/host-smoke.ts` — real OMP/Claude probe/launch command, not a test-only shortcut.
- Create or modify: `.github/workflows/harness-engine.yml` — typecheck, focused/full tests, native host smoke, evidence validation and artifact manifest upload.
- Create: `packages/control-plane/tests/application/harness-facade.test.ts` and `packages/harness-engine/tests/integration/{control-plane-host,unsupported-host,ci-evidence}.integration.test.ts`.
- Create: `packages/harness-engine/tests/evidence/host-ci-evidence.test.ts` with typed evidence validation.
- Create: `packages/harness-engine/src/ports/git-evidence.ts` with `GitEvidencePort.readCurrentHead()`, `readSourceHash()` and `readArtifactManifest()` typed results.
- Create: `packages/harness-engine/src/adapters/git/process-git-evidence.ts` implementing that port from the current repository process, with no task-content capture.
- Create: `packages/harness-engine/src/validation/host-ci-evidence.ts` with `validateHostCiEvidence`.
- Modify: `packages/control-plane/package.json` — preserve `"name": "@agent-system/control-plane"` and `"bin": { "configs": "src/cli/index.ts" }`; add `"exports": { "./application/public-entry": "./src/application/public-entry.ts" }` and verify that export resolves to the created public entry.
- Modify: `packages/harness-engine/package.json` — add `"@agent-system/control-plane": "workspace:*"` and import only `@agent-system/control-plane/application/public-entry`.
- Modify: root `package.json` — declare both `packages/control-plane` and `packages/harness-engine` in the workspace; verify the workspace dependency resolves before any Harness Engine build/test.
**Concrete DTO/function contract:**

```ts
export interface HarnessConfigRevisionRef {
  readonly revisionId: string;
  readonly schemaVersion: number;
  readonly clientId: 'omp' | 'claude';
  readonly observedAt: string;
}

export interface HarnessAssemblyManifestRef {
  readonly revisionId: string;
  readonly clientId: 'omp' | 'claude';
  readonly manifestDigest: string;
  readonly itemCount: number;
  readonly observedAt: string;
}

export interface HarnessClientCapability {
  readonly clientId: 'omp' | 'claude' | 'codex' | 'opencode';
  readonly clientVersion: string;
  readonly status: 'supported' | 'degraded' | 'unsupported' | 'unknown';
  readonly reasonCode?: string;
  readonly observedAt: string;
}

export interface HarnessLaunchPlanRef {
  readonly revisionId: string;
  readonly clientId: 'omp' | 'claude';
  readonly planDigest: string;
  readonly launchBoundary: 'invocation-scoped';
  readonly observedAt: string;
}

export interface HarnessControlPlanePort {
  readConfigRevision(revisionId: string): Promise<HarnessConfigRevisionRef | Unknown>;
  readAssemblyManifest(revisionId: string, clientId: 'omp' | 'claude'): Promise<HarnessAssemblyManifestRef | Unknown>;
  probeClient(clientId: 'omp' | 'claude' | 'codex' | 'opencode'): Promise<HarnessClientCapability | Unknown>;
  prepareLaunch(revisionId: string, clientId: 'omp' | 'claude'): Promise<HarnessLaunchPlanRef | Unknown>;
}
export interface ExistingPublicApplicationPorts {
  readonly readRevision: (revisionId: string) => Promise<HarnessConfigRevisionRef | Unknown>;
  readonly readManifest: (revisionId: string, clientId: 'omp' | 'claude') => Promise<HarnessAssemblyManifestRef | Unknown>;
  readonly probe: (clientId: 'omp' | 'claude' | 'codex' | 'opencode') => Promise<HarnessClientCapability | Unknown>;
  readonly planLaunch: (revisionId: string, clientId: 'omp' | 'claude') => Promise<HarnessLaunchPlanRef | Unknown>;
}

export interface HarnessControlPlanePortFactory {
  createHarnessControlPlaneFacade(): HarnessControlPlanePort;
}

export interface NotAvailableEvidence {
  readonly code: string;
  readonly reason: string;
  readonly observedAt: string;
  readonly evidence: readonly EvidenceRef[];
}

export interface HostCiEvidence {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly hostId: 'omp' | 'claude';
  readonly hostVersion: string;
  readonly capability: 'supported' | 'degraded' | 'unsupported' | 'unknown';
  readonly controlledState: 'pass' | 'fail' | 'blocked' | 'unknown';
  readonly realState: 'pass' | 'fail' | 'blocked' | 'unknown' | 'not-available';
  readonly notAvailable: readonly NotAvailableEvidence[];
  readonly artifactManifest: Readonly<{ readonly currentHead: string; readonly sourceHash: string; readonly artifactRefs: readonly EvidenceRef[]; readonly manifestHash: string; }>;
  readonly implementerId: string;
  readonly reviewerId: string;
  readonly evidence: readonly EvidenceRef[];
}

export function validateHostCiEvidence(value: unknown): HostCiEvidence;
export function createHarnessControlPlaneFacade(
  ports: ExistingPublicApplicationPorts,
): HarnessControlPlanePort;
```

The implementation task first maps each method to the actual current `ports.ts` types/functions and public caller; if an existing function has another name, its exact name is recorded in `harness-facade.ts` and migrated callers, never invented as an assumed pre-existing API. No Promise carrying `unknown` is allowed.

**TDD/smoke steps:**

- [ ] Step 1: Inventory `packages/control-plane/src/application/ports.ts` (the file currently contains interfaces/types), the package `bin` entry `packages/control-plane/src/cli/index.ts`, and every current application caller. Add an explicit migration table mapping `ConfigRevisionRepository.findById/listAll`, `ConfigRevisionWriter.create`, `ConfigSearchPort.search/rebuild`, and the current launch/Claude application port methods to the concrete Harness DTO functions in `public-entry.ts`.
- [ ] Step 2: Add failing contract tests for facade success, missing revision/manifest, capability probe failure, launch-plan failure, version mismatch and malformed DTO. Expected: no raw internal type or Promise carrying unknown crosses the boundary.
- [ ] Step 3: Add OMP/Claude native smoke command and evidence. The handler is `packages/harness-engine/src/cli/host-smoke.ts`; it calls `HarnessControlPlanePort.readConfigRevision/readAssemblyManifest/probeClient/prepareLaunch`, then invokes the selected real host path. `GitEvidencePort.readCurrentHead()` supplies currentHead, `readSourceHash()` supplies sourceHash, and `readArtifactManifest()` supplies the typed artifact manifest; the handler accepts `--host`, `--revision-id`, `--head`, `--source-hash`, `--artifact-manifest` and `--json`, then writes through `src/validation/host-ci-evidence.ts`.
- [ ] Step 4: Define `HostCiEvidence` with non-empty current head, source hash, host/client/version, capability state, explicit `notAvailable` records, typed controlled/real states, artifact manifest currentHead/sourceHash/hash, implementer and reviewer identities. `validateHostCiEvidence` rejects mismatched head/hash, missing not-available reason/evidence, unbound manifest and missing evidence; its focused validator test is `tests/evidence/host-ci-evidence.test.ts`.
- [ ] Step 5: Add Codex/OpenCode tests that return typed unsupported/unknown; run the existing control-plane OMP/Claude CLI entry and the native smoke command with natural saved configuration.
- [ ] Step 6: CI order is typecheck → focused tests → full tests → host smoke (real or explicit not-available) → typed evidence validator → artifact manifest upload. CI cannot promote not-available to pass.

**Commands / expected output:**

```text
$env:HARNESS_REAL_WRITE = '0'
$env:HARNESS_HOST_REVISION_ID = (Get-Item Env:HARNESS_HOST_REVISION_ID -ErrorAction SilentlyContinue).Value
if ([string]::IsNullOrWhiteSpace($env:HARNESS_HOST_REVISION_ID)) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend host --result not-available --missing HARNESS_HOST_REVISION_ID
  exit 0
}
bun run packages/harness-engine/src/cli/host-smoke.ts --host omp --revision-id $env:HARNESS_HOST_REVISION_ID --json
Expected: real OMP probe/launch evidence whose current head/source hash/artifact manifest are supplied by the handler's current repository readback, or not-available evidence with no host call.

if ([string]::IsNullOrWhiteSpace($env:HARNESS_HOST_REVISION_ID)) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend host --result not-available --missing HARNESS_HOST_REVISION_ID
  exit 0
}
bun run packages/harness-engine/src/cli/host-smoke.ts --host claude --revision-id $env:HARNESS_HOST_REVISION_ID --json
Expected: equivalent typed Claude evidence; no task content or transcript.

bun test packages/harness-engine/tests/integration packages/control-plane/tests
Expected: OMP/Claude existing behavior has no regression; unsupported hosts remain honest.
```

**Commit boundary:** `feat(harness): add actual control-plane typed facade host smoke and CI evidence gate`。

**Rollback:** 只撤销 Stage 5 facade/host/CI changes；不改 control-plane database/schema；保留 CI failure artifact and ledger row。

**Exit conditions:** facade is based on actual ports/public entry and concrete DTOs; OMP/Claude native smoke is a real command; CI evidence has current head/hash, gate states and artifact manifest；Codex/OpenCode unsupported/unknown。

**Stop conditions:** assumed non-existent control-plane method, Promise carrying `unknown`, test-only smoke, missing hash/head/artifact state, missing `@agent-system/control-plane` workspace resolution, missing `exports["./application/public-entry"]`, missing root workspace entries, or any filesystem/internal control-plane import. On any package wiring failure, mark Stage 5 blocked; do not use a fallback bridge or direct path import.

## Stage 6: 全量内化 Epic 5.6–5.8

**出口目标：** 不把 5.6–5.8 留作 deferred；将 artifact/path/migration、quality/audit/roles/plugin、host discovery/release/knowledge/observation 做成可执行等价本地能力。外部不可本地完成的部分必须由 typed evidence gate 表示，不得伪装成 active。

### Stage 6A: Artifact/path/migration

**Files:** `packages/harness-engine/src/artifacts/{paths,status-schema,project-register,residual,migration}.ts`; create `packages/harness-engine/src/cli/parsers/artifact-commands.ts` and `src/cli/commands/artifact-commands.ts`; modify `packages/harness-engine/src/cli/index.ts` dispatch; tests `tests/artifacts/*.test.ts` and `tests/cli/artifact-commands.test.ts`.

**Interfaces:**

```ts
export interface HarnessPathResolution { readonly root: string; readonly artifactPath: string; readonly source: 'explicit' | 'workspace'; readonly observedAt: string; }
export interface ArtifactSchemaStatus { readonly schemaVersion: number; readonly revision: number; readonly compatible: boolean; readonly migrationRequired: boolean; }
export interface MigrationResult { readonly sourceDigest: string; readonly targetDigest: string; readonly migrated: boolean; readonly evidence: readonly EvidenceRef[]; }
export interface ArtifactCommandResult { readonly command: 'path' | 'status' | 'project-register' | 'migrate'; readonly result: 'pass' | 'invalid' | 'unknown' | 'not-available'; readonly value?: HarnessPathResolution | ArtifactSchemaStatus | MigrationResult; readonly violations: readonly Violation[]; }
```

**Command grammar / TDD:**

- [ ] Parser accepts exactly `artifact path --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --json`, `artifact status --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --json`, `artifact project register --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --project-id $env:HARNESS_PROJECT_ID --json`, and `artifact migrate --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --source $env:HARNESS_MIGRATION_SOURCE --json`; implementation uses validated PowerShell environment values.
- [ ] Add failing parser/dispatch tests for missing/duplicate flags, path escape, non-ASCII/space path, unknown command, schema mismatch, source ownership ambiguity and migration target outside local ArtifactStore. Expected JSON is `{"command":"...","result":"invalid|unknown|not-available","violations":[...]}` with no private content.
- [ ] Implement command handlers in `src/cli/commands/artifact-commands.ts`; all writes call HarnessApplication and guarded ArtifactStore; migration is idempotent and never changes Orca/GitHub/control-plane objects.
- [ ] Run the Windows-copyable flow:

```powershell
$required = @('HARNESS_ARTIFACT_ROOT','HARNESS_WORKFLOW_ID')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) { bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend artifact --result not-available --missing ($missing -join ','); exit 0 }
bun run packages/harness-engine/src/cli/index.ts artifact path --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --json
bun run packages/harness-engine/src/cli/index.ts artifact status --root $env:HARNESS_ARTIFACT_ROOT --workflow-id $env:HARNESS_WORKFLOW_ID --json
```

Expected: typed JSON pass/invalid/unknown; missing variables write `result=not-available` and execute no artifact read/write. Run `artifact migrate` twice and expect identical target digest on the second run.

**Commit boundary:** `feat(harness): internalize artifact path status and migration contracts`.
**Rollback:** source artifact remains immutable; remove only newly created target revision after evidence capture; never overwrite external SSOT.
**Exit/stop:** exit when parser/dispatch/tests cover all four commands and migration is idempotent; stop on path escape, ambiguous ownership, schema incompatibility without read-only export or private-content output.

### Stage 6B: Quality/audit/roles/plugin

**Files:** `packages/harness-engine/src/quality/{lint,audit,roles,plugins,secret-supply-chain}.ts`; create `packages/harness-engine/src/cli/parsers/quality-commands.ts` and `src/cli/commands/quality-commands.ts`; modify `src/cli/index.ts` dispatch; tests `tests/quality/*.test.ts` and `tests/cli/quality-commands.test.ts`; sanitized plugin/skill fixtures.

**Interfaces:**

```ts
export interface QualityFinding { readonly code: string; readonly severity: 'info' | 'warning' | 'error'; readonly path: string; readonly evidence: EvidenceRef; readonly recovery: RecoveryAction; }
export interface RoleMapping { readonly roleId: string; readonly allowedHostIds: readonly string[]; readonly sourceDigest: string; readonly evidence: EvidenceRef; }
export interface PluginValidation { readonly pluginId: string; readonly version: string; readonly status: 'valid' | 'invalid' | 'unknown'; readonly findings: readonly QualityFinding[]; }
export interface QualityCommandResult { readonly command: 'quality-validate' | 'audit-run' | 'roles-check' | 'plugins-validate'; readonly result: 'pass' | 'invalid' | 'unknown' | 'not-available'; readonly findings: readonly QualityFinding[]; }
```

**Command grammar / TDD:**

- [ ] Parser accepts exactly `quality validate --root $env:HARNESS_QUALITY_ROOT --json`, `audit run --root $env:HARNESS_AUDIT_ROOT --json`, `roles check --map $env:HARNESS_ROLE_MAP --json`, and `plugins validate --root $env:HARNESS_PLUGIN_ROOT --json`; dispatch routes each grammar to the named handler in `src/cli/commands/quality-commands.ts`.
- [ ] Add failing parser/handler tests for missing flags, unknown subcommand, invalid metadata, role mismatch, secret/supply-chain finding and unavailable external source. Expected JSON is a `QualityCommandResult` with typed result and findings; private source text is absent.
- [ ] Internalize mechanical checks from old plugin/release/skill registry behavior; value, aesthetic, model and product decisions remain human decisions.
- [ ] Run `bun test packages/harness-engine/tests/quality packages/harness-engine/tests/cli/quality-commands.test.ts`; expect five samples per command and stable violation/recovery output.
- [ ] Run this Windows preflight and command sequence:

```powershell
$required = @('HARNESS_QUALITY_ROOT','HARNESS_AUDIT_ROOT','HARNESS_ROLE_MAP','HARNESS_PLUGIN_ROOT')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) { bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend quality --result not-available --missing ($missing -join ','); exit 0 }
bun run packages/harness-engine/src/cli/index.ts quality validate --root $env:HARNESS_QUALITY_ROOT --json
bun run packages/harness-engine/src/cli/index.ts audit run --root $env:HARNESS_AUDIT_ROOT --json
bun run packages/harness-engine/src/cli/index.ts roles check --map $env:HARNESS_ROLE_MAP --json
bun run packages/harness-engine/src/cli/index.ts plugins validate --root $env:HARNESS_PLUGIN_ROOT --json
```

Expected: each command returns typed pass/invalid/unknown; missing variables write `result=not-available` and run no validator.

**Commit boundary:** `feat(harness): internalize quality audit role and plugin gates`.
**Rollback:** remove only new local quality projections; retain source artifacts and failure evidence; invalid assets never become valid by fallback.
**Exit/stop:** exit when all four parsers/handlers/tests and negative samples pass; stop on unverifiable provenance, secret leakage or a human judgment reported as mechanical fact.

### Stage 6C: Host discovery/release/knowledge/observation

**Files:** `packages/harness-engine/src/host/{discovery,doctor,capability}.ts`; `src/release/{artifact,install,verification}.ts`; `src/knowledge/{compound,overlap,discoverability}.ts`; `src/observation/{snapshot,projection}.ts`; create `src/cli/parsers/lifecycle-commands.ts` and `src/cli/commands/lifecycle-commands.ts`; modify `src/cli/index.ts` dispatch; tests `tests/{host,release,knowledge,observation}/*.test.ts` and `tests/cli/lifecycle-commands.test.ts`.

**Interfaces:**

```ts
export interface HostCapabilitySnapshot { readonly hostId: string; readonly version: string; readonly status: 'contract' | 'fixture' | 'real-smoke' | 'active' | 'unsupported' | 'unknown'; readonly evidence: readonly EvidenceRef[]; }
export interface ReleaseVerification { readonly artifactDigest: string; readonly platform: string; readonly installedVersion?: string; readonly status: 'verified' | 'failed' | 'unknown'; readonly evidence: readonly EvidenceRef[]; }
export interface KnowledgeCrystal { readonly sourceRefs: readonly string[]; readonly contentDigest: string; readonly overlapChecked: boolean; readonly discoverable: boolean; readonly evidence: readonly EvidenceRef[]; }
export interface ObservationProjection { readonly source: 'workflow' | 'host' | 'release'; readonly observedAt: string; readonly state: string; readonly evidence: readonly EvidenceRef[]; }
export interface LifecycleCommandResult { readonly command: 'host-doctor' | 'release-verify' | 'knowledge-check' | 'observation-status'; readonly result: 'pass' | 'invalid' | 'unknown' | 'not-available'; readonly evidence: readonly EvidenceRef[]; }
```

**Command grammar / TDD:**

- [ ] Parser accepts exactly `host doctor --host $env:HARNESS_HOST_ID --version $env:HARNESS_HOST_VERSION --json`, `release verify --artifact $env:HARNESS_RELEASE_ARTIFACT --platform $env:HARNESS_RELEASE_PLATFORM --json`, `knowledge check --source $env:HARNESS_KNOWLEDGE_SOURCE --json`, and `observation status --workflow-id $env:HARNESS_WORKFLOW_ID --json`; dispatch routes them to `src/cli/commands/lifecycle-commands.ts`.
- [ ] Add failing parser/handler tests for missing flags, unknown command, host version mismatch, doctor failure, digest mismatch, release install failure, knowledge overlap failure, non-discoverable knowledge and observation source unavailable. Expected JSON is a `LifecycleCommandResult`; no task/session content is emitted.
- [ ] Run the Windows preflight and all four commands:

```powershell
$required = @('HARNESS_HOST_ID','HARNESS_HOST_VERSION','HARNESS_RELEASE_ARTIFACT','HARNESS_RELEASE_PLATFORM','HARNESS_KNOWLEDGE_SOURCE','HARNESS_WORKFLOW_ID')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) { bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend lifecycle --result not-available --missing ($missing -join ','); exit 0 }
bun run packages/harness-engine/src/cli/index.ts host doctor --host $env:HARNESS_HOST_ID --version $env:HARNESS_HOST_VERSION --json
bun run packages/harness-engine/src/cli/index.ts release verify --artifact $env:HARNESS_RELEASE_ARTIFACT --platform $env:HARNESS_RELEASE_PLATFORM --json
bun run packages/harness-engine/src/cli/index.ts knowledge check --source $env:HARNESS_KNOWLEDGE_SOURCE --json
bun run packages/harness-engine/src/cli/index.ts observation status --workflow-id $env:HARNESS_WORKFLOW_ID --json
```

Expected: each handler returns typed pass/invalid/unknown; missing variables write `result=not-available` and execute no external read. Release installed/running state never implies verified; observation never becomes SSOT; knowledge output is digest/references only.
- [ ] Add contract/fixture/real-smoke/active transition tests; externally unavailable checks stay unknown/not-available and never active.

**Commit boundary:** `feat(harness): internalize host release knowledge and observation lifecycle`.
**Rollback:** roll back local projections/verification only; preserve source artifacts and evidence; never delete external installation or host state.
**Exit/stop:** exit when all four named command forms (`host doctor`, `release verify`, `knowledge check`, `observation status`) have parser/dispatch/handler/tests and local equivalents; stop when a projection is treated as SSOT, a host is active without real smoke, or knowledge copies private/session content.
## Stage 7: Independent review、external acceptance 与 merge-ready

**出口目标：** 用 fresh reviewer、当前 head/range、immutable evidence 和六个 hard gates 形成独立 `ValidationDecision`；所有 stage 交付分层完成后才可 Verified/merge-ready。

- Create: `packages/harness-engine/src/validation/independent-review.ts`.
- Create: `packages/harness-engine/src/validation/hard-gates.ts`.
- Create: `packages/harness-engine/src/validation/validation-decision.ts`.
- Create: `packages/harness-engine/src/cli/parsers/review-command.ts` and `packages/harness-engine/src/cli/commands/review-command.ts`; modify `packages/harness-engine/src/cli/index.ts` parser/dispatch because the current review CLI does not exist.
- Create: `packages/harness-engine/src/cli/parsers/acceptance-command.ts` and `packages/harness-engine/src/cli/commands/acceptance-command.ts`; modify `packages/harness-engine/src/cli/index.ts` acceptance parser/dispatch because `validate acceptance` is a new handler.
- Create: `packages/harness-engine/tests/validation/{independent-review,hard-gates,validation-decision}.test.ts`, `packages/harness-engine/tests/cli/{review-command,acceptance-command}.test.ts`.
- Create: `docs/superpowers/evidence/harness-engine/2026-08-28-acceptance/{validation-decision,hard-gates,independent-review,merge-readiness}.json`.
- Modify: `packages/harness-engine/src/validation/failure-ledger.ts` only for evidence integration.

**Interfaces:**

```ts
export type ReviewFindingStatus = 'unresolved' | 'resolved' | 'accepted' | 'deferred';

export interface ReviewFinding {
  readonly id: string;
  readonly severity: 'major' | 'minor' | 'info';
  readonly status: ReviewFindingStatus;
  readonly resolution?: string;
  readonly evidence?: readonly EvidenceRef[];
}

export interface IndependentReviewRecord {
  readonly implementerId: string;
  readonly reviewerId: string;
  readonly currentHead: string;
  readonly reviewRange: string;
  readonly reviewPackage: ReviewPackage;
  readonly command: string;
  readonly findings: readonly ReviewFinding[];
  readonly observedAt: string;
}
export interface EvidenceManifest {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly artifactRefs: readonly EvidenceRef[];
  readonly manifestHash: string;
}

export interface HardGateResult {
  readonly name: 'code-tests' | 'failure-ledger' | 'ownership' | 'independent-review' | 'controlled-integration' | 'real-smoke';
  readonly state: 'pass' | 'fail' | 'blocked' | 'unknown' | 'not-available';
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly failureRefs: readonly EvidenceRef[];
}

export interface TypedCiHarnessEvidence {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly branch: string;
  readonly worktree: string;
  readonly gateStates: Readonly<{ readonly controlled: HardGateResult['state']; readonly real: HardGateResult['state']; readonly notAvailable: readonly string[]; }>;
  readonly reviewIdentities: Readonly<{ readonly implementerId: string; readonly reviewerId: string; }>;
  readonly evidenceManifest: EvidenceManifest;
  readonly failureLedger: FailureLedger;
}

export interface ValidationDecision {
  readonly currentHead: string;
  readonly sourceHash: string;
  readonly state: 'Partial' | 'Draft' | 'Blocked' | 'Unknown' | 'Verified';
  readonly hardGates: readonly HardGateResult[];
  readonly evidenceManifest: EvidenceManifest;
  readonly missingOrConflictingFacts: readonly string[];
  readonly recoveryActions: readonly string[];
  readonly uniqueOwner: string;
  readonly decidedAt: string;
}

export function validateHardGateBundle(input: unknown): readonly HardGateResult[];
export function validateValidationDecision(input: unknown): ValidationDecision;
```

**Independent-review procedure and TDD:**

- [ ] Step 1: Implement `src/cli/parsers/review-command.ts`, `src/cli/commands/review-command.ts` and the `review` branch in `src/cli/index.ts` before invoking the command. PowerShell first validates `$env:HARNESS_REVIEW_BASE_SHA`, `$env:HARNESS_REVIEW_HEAD_SHA` and `$env:HARNESS_REVIEWER_ID`; if any is missing, it runs the evidence writer with `result=not-available` and exits without a review call. If all are present, it runs the fresh reviewer command below; reviewer identity must differ from the implementer recorded in ownership.
- [ ] Step 2: Generate `ReviewPackage` bound to the concrete `base..head`, record implementer/reviewer IDs, command, findings, resolutions and evidence. Reject old head/package reuse.
- [ ] Step 3: Add acceptance tests that read and validate `independent-review.json`: reviewer differs from implementer, current head matches, range equals review package, every finding has one of `unresolved | resolved | accepted | deferred`, and all evidence timestamps/locators validate. An `unresolved` major finding immediately blocks acceptance; minor/info findings require either non-empty resolution evidence or explicit `accepted`/`deferred` status with a rationale.
- [ ] Step 4: Implement `validateHardGateBundle` in `packages/harness-engine/src/validation/hard-gates.ts` and `validateValidationDecision` in `packages/harness-engine/src/validation/validation-decision.ts`. Require exactly six typed gates, bind every gate's currentHead/sourceHash/evidenceRefs/failureRefs to the bundle, and require all six `state=pass` plus both real Orca/GitHub smoke results `pass` before `state=Verified`; `not-available` is never pass.
- [ ] Step 5: Add tests for every hard gate: code/tests, failure ledger, ownership, independent review, controlled integration and real smoke. Tests must reject missing gate, mismatched head/hash, string-only evidence, non-empty failureRefs on pass, not-available real smoke, a ValidationDecision that claims Verified without all six passes, an unresolved major finding, and a finding without status.
- [ ] Step 6: Add CI invocation `validate acceptance` that reads typed `TypedCiHarnessEvidence`, `independent-review.json`, `hard-gates.json`, failure ledger and evidence manifest; missing fields or any non-pass produces Partial/Draft/Blocked/Unknown.
- [ ] Step 7: Run focused tests, full Harness tests, control-plane tests, Windows-safe real smoke and Stage 6 tests at the same head; update failure ledger and rerun every current failure.
- [ ] Step 8: Re-evaluate six hard gates. Real Orca and GitHub smoke are both required `pass`; `not-available` is not pass. Any failure/blocked/unknown/not-available yields Partial/Draft/Blocked/Unknown.
- [ ] Step 9: Hash the exact evidence bundle, record typed artifact manifest and create `ValidationDecision`; never use BMad/sprint status or Plan Done as its input.

**Commands / expected output:**

```powershell
$required = @('HARNESS_REVIEW_BASE_SHA','HARNESS_REVIEW_HEAD_SHA','HARNESS_REVIEWER_ID')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Get-Item "Env:$($_)" -ErrorAction SilentlyContinue).Value) })
if ($missing.Count -gt 0) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend review --result not-available --missing ($missing -join ',')
  exit 0
}
bun run packages/harness-engine/src/cli/index.ts review --base $env:HARNESS_REVIEW_BASE_SHA --head $env:HARNESS_REVIEW_HEAD_SHA --reviewer $env:HARNESS_REVIEWER_ID --json
```

Expected: when all three variables are non-empty, `independent-review.json` contains distinct implementer/reviewer identities, concrete range, current head and resolution evidence; when any is missing, evidence is `result=not-available` and no reviewer command runs.

```powershell
$env:HARNESS_EVIDENCE_MANIFEST = (Get-Item Env:HARNESS_EVIDENCE_MANIFEST -ErrorAction SilentlyContinue).Value
if ([string]::IsNullOrWhiteSpace($env:HARNESS_EVIDENCE_MANIFEST)) {
  bun run packages/harness-engine/src/cli/index.ts smoke evidence --backend acceptance --result not-available --missing HARNESS_EVIDENCE_MANIFEST
  exit 0
}
bun run packages/harness-engine/src/cli/index.ts validate acceptance --evidence-manifest $env:HARNESS_EVIDENCE_MANIFEST --json
```

Expected: `validateHardGateBundle` validates all six typed gate records and `validateValidationDecision` returns Verified only when every gate, including real smoke, is pass; otherwise it returns a non-Verified state with gate-specific failureRefs.

```text
bun test packages/harness-engine/tests/validation packages/harness-engine/tests packages/control-plane/tests
Expected: focused validation, full Harness and control-plane suites pass at the recorded current head, or every current failure is closed in the ledger.

bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
Expected: exit 0，无 diagnostics。
```

**Commit boundary:** evidence bundle only after independent review and six hard gates pass：`test(harness): record external acceptance evidence`。不 merge、不 push，不修改 BMad 状态作为替代。

**Rollback:** 任一 gate 回归则保留 immutable evidence，标记 non-Verified，停止新外部写入，追加 current failure row；只回滚引入回归的 source commit，不抹除证据、不强制合并。

**Exit conditions / delivery layers:**

1. **local contract closure:** Stage 1–2 application/gates/P0 samples 全通过，raw writer 无 bypass。
2. **controlled integration closure:** Stage 3 contracts/负例全通过，明确 controlled 非 real。
3. **CI merge gate:** Stage 5 workflow、typed CI evidence、current head/hash、artifact manifest、ownership、failure ledger、review identity checks 全通过。
4. **real backend/host evidence:** Stage 4 Orca/GitHub current readback 与 Stage 5 OMP/Claude native smoke 有当前证据；不可得项保留 not-available。
5. **external acceptance/Verified/merge-ready:** 六硬门全部 pass，含真实 Orca/GitHub smoke、fresh independent review 和 immutable evidence。

**Final stop rules:** 任一 hard gate 为 fail、blocked、unknown 或 not-available；当前失败未归因/未重跑/无 closure；ownership 冲突；head/range/hash 过期；real smoke 缺失；controlled 被冒充 real；BMad/Plan Done 被用作验收；均停止在 Partial/Draft/Blocked/Unknown，绝不宣布 external acceptance。

## Plan Self-Check

- [ ] Stage 0–7 均包含 Files、Interfaces、TDD、commands、expected output、commit boundary、rollback、exit/stop。
- [ ] Stage 1 明确移除 CLI direct JsonArtifactStore、synthetic defaults/host capability/lease，迁移所有 caller/factory，收窄 raw export，并覆盖 direct construction/Done snapshot/invalid transition negatives。
- [ ] Stage 2 先建立 gate ownership inventory，已有 gate 只 reconcile/扩展。
- [ ] Stage 4 使用 PowerShell Windows-safe commands 并显式设置 HARNESS_REAL_WRITE=0；真实 smoke 严格只读，write-after-readback 独立为 blocked write plan，不在本计划实现。
- [ ] Stage 5 不假设不存在的 control-plane 方法；基于实际 `application/ports.ts` 和新建 `application/public-entry.ts` 建立具体 DTO/function typed facade，强制 package exports/root workspace/harness dependency 校验，禁止 filesystem/internal import、Promise carrying unknown 或 fallback bridge，并有真实 OMP/Claude native smoke command。
- [ ] Stage 6 真实覆盖 Epic 5.6–5.8，不作为 deferred；外部不可得部分有本地等价能力和 evidence gate。
- [ ] Stage 7 independent-review procedure、review package、identity/head/range/resolution、independent-review.json validator、typed CI evidence 和六硬门均可执行。
- [ ] Stage 7 includes concrete `validateHardGateBundle`/`validateValidationDecision` files and tests; each gate has typed state, currentHead/sourceHash, evidenceRefs and failureRefs; `not-available` cannot produce Verified.
- [ ] Stage 4/Stage 7 command blocks contain no angle-bracket argument placeholders; they validate required environment variables and write not-available evidence without invoking the real command when values are missing.
- [ ] FailureLedger 当前失败强制 rerunResult 或 closureEvidence；零失败采用明确 zero rows 结构；无 daemon、自动重派、第三实时源、跨宿主配置等价或 Session 内容复制。
