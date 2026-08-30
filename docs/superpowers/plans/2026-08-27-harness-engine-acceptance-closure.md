# Harness Engine Acceptance Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先恢复 `packages/harness-engine` 可运行基线，再收口 Epic 5 Story 5.1/5.2 门禁，并明确 5.3/5.4 真实后端入口与 5.5–5.8 延期边界；本轮只规划。

**Architecture:** Harness Engine 是独立纯 TypeScript/Bun 六边形库；领域内核拥有 Workflow/Plan/Assignment/Lease/Worktree/Review/Gate，JSON ArtifactStore 与 Orca/GitHub/Host 通过公开 port 接入。5.1 只拥有 Plan 状态图与现有 `CompletionEvidence`，review package、具体 BASE..HEAD、QC/QA、residual、delivery 的结构化完成门由 5.2 承接。

**Tech Stack:** TypeScript、Bun、`bun:test`、Node/Bun 标准库、版本化 JSON ArtifactStore；不新增运行时依赖。

**Spec:** `_bmad-output/specs/spec-harness-engine/SPEC.md`; `_bmad-output/specs/spec-harness-engine/validation-contract.md`; `_bmad-output/planning-artifacts/architecture/architecture-harness-engine/ARCHITECTURE-SPINE.md`; `_bmad-output/planning-artifacts/epics.md` Epic 5。

## Global Constraints

- MUST 保留 `packages/control-plane` 配置修订、OMP/Claude 装配、隐私和安全启动职责；Harness Engine 不得导入其内部领域或 SQLite repository。
- MUST 使领域内核不依赖 Bun、SQLite、文件系统、进程环境、Orca SDK 或 GitHub SDK。
- MUST 使用 Plan `Todo | InProgress | InReview | Blocked | Done`、Gate `pass | fail | blocked | unknown` 和带来源/时间的 `Known`/`Unknown`。
- MUST 校验 workflow/plan、branch/worktree、owned paths、execution lease；integration lease 独占；无法证明 stale lease 已失效不得强抢。
- MUST 让 `worker_done` 最多推进到 `InReview`；review package 使用具体 `baseSha`、`headSha` 和 `baseSha..headSha`，不得使用 `HEAD~1`/`HEAD^`。
- MUST 默认 `sdd` 三席 QC，只有 `inline` 一席；QC/QA 绑定同一 `planId`/diff basis；失败带阶段、稳定 code、证据状态、恢复动作。
- MUST NOT 把静态文档、fake、controlled fixture、注入结果当 real smoke/active；缺真实 Orca/GitHub 对象、权限或网络记录 `not available`，且 `not available` 只是门状态，不是 external acceptance/`Verified`/`active` 的 `pass`。
- MUST 将 BMad Epic/Story 文档状态及 `sprint-status=done` 视为范围/预期记录；它们不得覆盖代码、测试、failure ledger、worktree/file ownership、independent review、controlled integration、real smoke 的外部 acceptance 硬门。硬门缺失或相互冲突时 MUST fail closed，并列出缺失/冲突项、恢复动作、唯一 owner 和证据引用；补齐并核验前只能保持 `Partial`、`Draft`、`Blocked` 或 `Unknown`，不得把 `Done` 当作 acceptance `Verified`。

- MUST NOT 引入 daemon、常驻轮询、自动重派/唤醒、第三实时状态源、跨宿主 Session 翻译或配置等价。
- MUST NOT 执行 reset/revert/clean/restore/checkout 覆盖、force push，或删除/覆盖未归属 WIP；不得触碰 control-plane 已推送历史。
- MUST NOT 将 `.omp/`、`diagrams/`、已有 foundation plan 或未授权架构/计划文件纳入提交。
- 每个实现任务按红测试→最小绿实现→focused 验证；项目级验证最后执行。

## Current code and file inventory

### Read-only authority

- `_bmad-output/specs/spec-harness-engine/SPEC.md`
- `_bmad-output/specs/spec-harness-engine/validation-contract.md`
- `_bmad-output/planning-artifacts/architecture/architecture-harness-engine/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/epics.md` Epic 5
- `_bmad-output/implementation-artifacts/sprint-status.yaml` 的 `epic-5` 与 `5-1`～`5-8`，上一轮读取值均为 `backlog`；执行时重新读取
- `docs/superpowers/plans/2026-08-27-harness-engine-foundation.md`，只读不得覆盖

### Previous observation snapshot — not current worktree fact

- 上一轮观测快照记录：当前已观测 10 个失败断言，分布于 7 个 Harness 测试文件；具体路径以执行时新采集的 failure ledger 为准。该数字不是当前工作树事实，不能直接作为执行起点。
- 上一轮 dirty 快照曾发现若干 status、plan 与 Harness source/test 路径；它们只作为待复核提示，不代表当前仍 dirty、仍归属同一 agent 或数量不变。执行时统一标记为“待归属 WIP”，以当前采集结果为准。
- 上一轮 untracked 快照曾列出 `.omp/`、`diagrams/`、`_bmad-output/planning-artifacts/architecture/architecture-harness-engine/`、`_bmad-output/specs/spec-harness-engine/` 和两个计划文档；执行时必须重新采集，不能沿用其当前状态判断。

### Existing tracked Harness code/test inventory — status intentionally not asserted

- Package/config: `packages/harness-engine/package.json`, `packages/harness-engine/tsconfig.json`
- Core: `packages/harness-engine/src/core/result.ts`, `packages/harness-engine/src/core/ids.ts`
- Domain: `packages/harness-engine/src/domain/workflow.ts`, `packages/harness-engine/src/domain/assignment.ts`, `packages/harness-engine/src/domain/lease.ts`, `packages/harness-engine/src/domain/review.ts`
- Ports: `packages/harness-engine/src/ports/artifacts.ts`, `packages/harness-engine/src/ports/coordination.ts`, `packages/harness-engine/src/ports/delivery.ts`, `packages/harness-engine/src/ports/host.ts`
- Adapter: `packages/harness-engine/src/adapters/json/json-artifact-store.ts`
- Gates: `packages/harness-engine/src/gates/dispatch.ts`, `packages/harness-engine/src/gates/worktree.ts`, `packages/harness-engine/src/gates/sdd.ts`, `packages/harness-engine/src/gates/iteration.ts`, `packages/harness-engine/src/gates/pr-review.ts`
- Public surface: `packages/harness-engine/src/index.ts`
- Existing test inventory: `packages/harness-engine/tests/core/result.test.ts`; `packages/harness-engine/tests/domain/assignment.test.ts`, `packages/harness-engine/tests/domain/lease.test.ts`, `packages/harness-engine/tests/domain/workflow.test.ts`; `packages/harness-engine/tests/gates/dispatch.test.ts`, `packages/harness-engine/tests/gates/worktree.test.ts`, `packages/harness-engine/tests/gates/sdd.test.ts`, `packages/harness-engine/tests/gates/iteration.test.ts`, `packages/harness-engine/tests/gates/pr-review.test.ts`; `packages/harness-engine/tests/adapters/json-artifact-store.test.ts`

### Evidence output and allowed future additions

- Create during Stage 0 only: `docs/superpowers/evidence/2026-08-27-harness-engine-failure-ledger.md`。
- Ledger fields are `capturedAt`, `worktreePath`, `branch`, `observedRevision`, `suiteCommand`, `suiteExitCode`, `testPath`, `assertionName`, `firstError`, `contractRef`, `owningFile`, `owner`, `status`, `rerunCommand`, `rerunResult`, and `notes`. `suiteCommand`/`firstError`/`rerunResult` must be copied from current command output; the previous snapshot cannot populate them.
- No new adapter, architecture, runtime, status or plan file is authorized. Only if existing `sdd.ts` cannot own plan-level completion without mixing contracts may implementation add `packages/harness-engine/src/gates/completion.ts` and `packages/harness-engine/tests/gates/completion.test.ts`。
- `docs/superpowers/plans/2026-08-27-harness-engine-acceptance-closure.md` is the only plan being created now; the foundation plan remains read-only。

---
### Task 1: Stage 0 / A — concurrent WIP ownership and runnable baseline

**Files:**
- Inspect all Harness source/tests and authority files above。
- Create during execution only: `docs/superpowers/evidence/2026-08-27-harness-engine-failure-ledger.md`。
- Modify only the Harness file explicitly named by a current failure-ledger entry after ownership is confirmed。
- Never modify/stage status/spec/architecture files, `.omp/`, `diagrams/`, foundation plan, control-plane or unowned WIP。

**Interfaces:**
- Failure ledger fields: `capturedAt`, `worktreePath`, `branch`, `observedRevision`, `suiteCommand`, `suiteExitCode`, `testPath`, `assertionName`, `firstError`, `contractRef`, `owningFile`, `owner`, `status`, `rerunCommand`, `rerunResult`, `notes`。
- The 10-failure/7-file count is a previous observation snapshot, not current worktree fact. Baseline means the execution-time ledger has no unresolved failure and the current Harness suite/typecheck pass。

- [ ] **Step 1: Capture WIP**

  ```bash
  git status --short --branch
  git worktree list --porcelain
  git diff --name-status
  git ls-files --others --exclude-standard
  git diff --binary -- packages/harness-engine > /tmp/harness-engine-acceptance-before.patch
  ```

  Expected: execution-time branch/worktree, tracked modified, untracked and owner evidence is captured. Previous dirty/untracked snapshots are not reused as current facts; no destructive Git action runs。

- [ ] **Step 2: Reproduce and populate the current failure ledger**
  `bun test packages/harness-engine/tests 2>&1 | tee /tmp/harness-engine-acceptance-current.log`
  Create `docs/superpowers/evidence/2026-08-27-harness-engine-failure-ledger.md` from this command's current output. Use one row per current failing assertion, including all fields in the Files/Interfaces contract; use the previous 10/7 snapshot only as a comparison note.
  Expected: the ledger is populated from the current command output, not copied from the previous observation. Current failing assertion count and file count may differ; every current failure has an owning file and contract reference。
- [ ] **Step 3: Repair mapped contracts only**

  Preserve concurrent hunks; use existing public names/DTOs. Do not alter an unrelated port to make a test compile, and do not turn Unknown into null/false/pass。

- [ ] **Step 4: Prove baseline**

  ```bash
  bun test packages/harness-engine/tests
  bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
  ```

  Expected: the execution-time ledger has zero unresolved failures, the current full Harness suite passes, and typecheck passes. Focused reruns use only the exact paths in the execution-time ledger; the previous 10/7 snapshot is not used as the result。

- [ ] **Step 5: Commit boundary**

  Future commit only attributed baseline files: `chore(harness): restore acceptance test baseline`。

---

### Task 2: Story 5.1 / B — deterministic Plan state graph

**Files:**
- Modify `packages/harness-engine/src/domain/workflow.ts` only for status graph and existing evidence boundary。
- Test `packages/harness-engine/tests/domain/workflow.test.ts`。
- Inspect/modify `packages/harness-engine/src/index.ts` only if export is missing。
- Do not modify adapter ports, control-plane or Story 5.2 completion gate。

**Interfaces:**
- `PlanStatus = 'Todo' | 'InProgress' | 'InReview' | 'Blocked' | 'Done'`。
- `transitionPlanStatus(plan: PlanRow, nextStatus: PlanStatus, evidence?: CompletionEvidence): PlanRow`。
- Only legal edges: `Todo -> InProgress`; `InProgress -> InReview|Blocked`; `Blocked -> InReview`; `InReview -> Done`。
- `Done` terminal; every omitted edge and `Done -> Done` fails。
- Existing `CompletionEvidence` only covers local lease/review/QA booleans; missing required evidence fails closed。
- 5.1 MUST NOT claim package/BASE..HEAD/QC/QA identity/residual/delivery/Orca/GitHub evidence; Task 3 owns that migration gate。

- [ ] **Step 1: Red tests**

  ```ts
  expect(() => transitionPlanStatus(plan('Todo'), 'InReview')).toThrow('Invalid plan status transition');
  expect(() => transitionPlanStatus(plan('InProgress'), 'Done', completeEvidence)).toThrow('Invalid plan status transition');
  expect(() => transitionPlanStatus(plan('Done'), 'InReview')).toThrow('Invalid plan status transition');
  expect(() => transitionPlanStatus(plan('InReview'), 'Done')).toThrow('Completion evidence');
  expect(() => transitionPlanStatus(plan('InReview'), 'Done', { leaseRemaining: true, reviewComplete: true, qaComplete: true })).toThrow('lease');
  expect(() => transitionPlanStatus(plan('InReview'), 'Done', { leaseRemaining: false, reviewRequired: true, qaRequired: true, qaComplete: true })).toThrow('review');
  expect(() => transitionPlanStatus(plan('InReview'), 'Done', { leaseRemaining: false, reviewComplete: true, qaRequired: true })).toThrow('QA');
  ```

  Also assert legal transition returns a new row, preserves original, and does not re-enter Done。

- [ ] **Step 2: Red command**

  `bun test packages/harness-engine/tests/domain/workflow.test.ts`

  Expected: tightened cases fail until current WIP exactly satisfies the graph; baseline-only failures belong to Task 1。

- [ ] **Step 3: Minimal green implementation**

  Keep a closed transition table, validate both statuses, preserve local lease/review/QA guards, and do not add structural delivery fields。

- [ ] **Step 4: Green command/typecheck**

  ```bash
  bun test packages/harness-engine/tests/domain/workflow.test.ts
  bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
  ```

  Expected: workflow tests pass, zero errors。

- [ ] **Step 5: Commit boundary**

  Future commit `feat(harness): close deterministic plan status gate`, only owned workflow/test/export files。

---

### Task 3: Story 5.2 / C — lease/worktree and structured SDD/QC/QA gate

**Files:**
- Modify `packages/harness-engine/src/domain/lease.ts`, `src/gates/worktree.ts`, `src/domain/review.ts`, `src/gates/sdd.ts`。
- Create only when necessary `packages/harness-engine/src/gates/completion.ts`。
- Modify `src/index.ts` only for owned exports。
- Test `packages/harness-engine/tests/domain/lease.test.ts`, `tests/gates/worktree.test.ts`, `tests/gates/sdd.test.ts`。
- Create `tests/gates/completion.test.ts` only with the source gate。

**Interfaces:**

```ts
interface ExecutionLease { readonly kind: 'execution'; readonly workflowId: string; readonly planId: string; readonly holderId: string; readonly worktreePath: string; readonly fencingToken: number; readonly claimedAt: string; }
interface IntegrationMergeLease { readonly kind: 'integration-merge'; readonly workflowId: string; readonly integrationBranch: string; readonly holderId: string; readonly fencingToken: number; readonly claimedAt: string; }
function claimLease(current: Lease | LeaseState | LeaseReleaseResult | undefined | null, claim: LeaseClaim, staleProof?: StaleProof | true): LeaseClaimResult;
function releaseLease(current: Lease | LeaseState | undefined | null, holderId: string, fencingToken: number): LeaseReleaseResult;
function validateWorktreeAlignment(input: WorktreeAlignmentInput): GateResult<WorktreeAlignment>;
interface ReviewPackage { readonly planId: string; readonly taskId: string; readonly baseSha: string; readonly headSha: string; readonly path: string; readonly createdAt: string; }
function validateReviewPackage(value: unknown): value is ReviewPackage;
function validateSddGate(input: SddGateInput): GateResult<ReviewReady>;
```

If plan-level completion needs a separate gate, use:

```ts
interface DiffBasis { readonly baseSha: string; readonly headSha: string; readonly reviewRange: string; }
interface QcEvidence extends DiffBasis { readonly planId: string; readonly executionMode: 'sdd' | 'inline'; readonly seats: 1 | 3; readonly reviewerIds: readonly string[]; readonly passed: boolean; readonly evidence: readonly EvidenceRef[]; }
interface QaEvidence extends DiffBasis { readonly planId: string; readonly passed: boolean; readonly evidence: readonly EvidenceRef[]; }
interface DeliveryEvidence { readonly planId: string; readonly headSha: string; readonly evidence: readonly EvidenceRef[]; }
interface PlanCompletionInput extends DiffBasis { readonly planId: string; readonly workerDone: boolean; readonly reviewPackages: readonly ReviewPackage[]; readonly qc: QcEvidence; readonly qa: QaEvidence; readonly residualClosures: readonly ResidualClosure[]; readonly delivery: DeliveryEvidence; readonly executionLease?: ExecutionLease; }
interface PlanCompletionDecision extends DiffBasis { readonly planId: string; }
function validatePlanCompletion(input: PlanCompletionInput): GateResult<PlanCompletionDecision>;
```

Rules: packages/evidence arrays non-empty；all package/QC/QA/delivery identities and diff basis align；range exact；`sdd` exactly three seats/reviewer IDs、`inline` one；residual has owner/decision/target/closure evidence；delivery matches current head；execution lease absent。Malformed/missing facts fail；contention/stale head/unproved stale lease blocked；unreadable external evidence unknown；only concrete aligned evidence passes。

每个 P0 能力在 Task 3 exit 前都必须覆盖 validation-contract 的五类样本：normal path；missing fact/permission/response；identity/version mismatch；Unknown 或 Blocked branch；repeat operation 或 irreversible-state negative。这里的 P0 能力逐项包括 execution lease claim/release、integration merge lease exclusivity、worktree/owned-path alignment、review package/BASE..HEAD、SDD QC seat/identity、QA/residual/delivery completion gate。每一项都必须在 controlled fixture 测试中有可定位断言，并在当前 failure ledger/验证记录中标明结果；缺任一类别不得提交 Task 3。

- [ ] **Step 1: Red controlled fixtures** — in-memory only. For each P0 capability listed above, add one normal case, one missing fact/permission/response case, one identity/version mismatch case, one Unknown or Blocked case, and one repeat/irreversible negative. Cover first claim, same-holder resume, second writer block, explicit stale-proof-only steal/fencing increment, mismatched release, integration exclusivity, every worktree mismatch/overlap, missing/guessed/stale BASE..HEAD, package/QC identity/seat mismatch, missing residual/delivery, and worker_done not Done。
- [ ] **Step 2: Red command**

  ```bash
  bun test packages/harness-engine/tests/domain/lease.test.ts packages/harness-engine/tests/gates/worktree.test.ts packages/harness-engine/tests/gates/sdd.test.ts
  ```

  If `packages/harness-engine/tests/gates/completion.test.ts` was created with its source gate, run it as a separate focused command. Expected: new structured/error cases fail; Task 1 failures are not accepted as new red cases。

- [ ] **Step 3: Minimal green implementation** — keys are `workflowId + planId + worktreePath` or `workflowId + integrationBranch`; fencing survives release; only explicit stale proof permits steal; compare every identity/path; exact concrete range; keep Task 2 `CompletionEvidence` unchanged; require structured gate before final status。
- [ ] **Step 4: Green command/typecheck**

  ```bash
  bun test packages/harness-engine/tests/domain/lease.test.ts packages/harness-engine/tests/gates/worktree.test.ts packages/harness-engine/tests/gates/sdd.test.ts
  bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
  ```

  If the optional completion pair exists, its focused test must also pass. Expected: focused tests pass, zero errors, no real backend contact。

- [ ] **Step 5: Commit boundary** — future commit `feat(harness): close lease worktree and review gates`, only Task 3 files。

---

### Task 4: External gate triage / controlled integration boundary — no real Orca/GitHub smoke

**Files:**
- No Orca/GitHub adapter source, remote object, credential, network or real-smoke evidence file is created。
- Inspect only: `packages/harness-engine/src/ports/coordination.ts`, `packages/harness-engine/src/ports/delivery.ts`, `packages/harness-engine/src/ports/host.ts`, `packages/harness-engine/src/gates/pr-review.ts` and their current mechanical/controlled fixture tests。
- Do not modify `packages/control-plane/` or any current adapter-port WIP。

**Interfaces and boundary:**
- Story 5.3 later consumes `CoordinationAdapter.getRun/getTask/getDispatch/getWorker/getDelivery` and stable-ID allowlist DTOs；Story 5.4 later consumes `DeliveryAdapter.getIssue/getPullRequest/getChecks/getReviews/prepareMergeReady/readAfterMerge` with current head/expected-head and post-write readback。
- This plan performs no real Orca/GitHub smoke. Task 4 can output only `not available` or `blocked`。
- If a read-only preflight finds a natural object, usable permission and network, output `blocked` with exact blocker `real-smoke-requires-independent-plan` and hand off to a separate real-smoke plan；do not run the smoke here。
- If any natural object, permission or network prerequisite is absent, output `not available` with the exact missing/unknown prerequisite and do not create a remote object。

- [ ] **Step 1: Run only mechanical/controlled fixture checks**

  ```bash
  bun test packages/harness-engine/tests/core/result.test.ts packages/harness-engine/tests/gates/pr-review.test.ts
  ```

  Expected: current ports and PR-review mechanical/controlled fixtures pass or produce a contract failure；no Orca/GitHub request is made and no output is classified as real smoke。

- [ ] **Step 2: Perform read-only external preflight only when the existing CLI is available**

  Resolve the Orca executable exactly as prescribed by `skill://orca-cli` (`ORCA_CLI_COMMAND`, otherwise the environment-provided Orca executable), then run `skills get orca-cli` on that resolved executable to load its version-matched guide, followed only by `status --json`, `worktree ps --json`, and `terminal list --json` as read-only probes. For GitHub run `gh auth status`, `gh repo view --json nameWithOwner,isPrivate,defaultBranchRef`, and `gh pr list --state open --limit 1 --json number,url,headRefOid,baseRefName` only；do not run a write command。

  Expected: record command, exit code, object availability, permission result and network result. If all three prerequisites are visible, return `blocked` with `real-smoke-requires-independent-plan`; if any prerequisite is absent or the CLI is unavailable, return `not available` with the exact missing/unknown prerequisite. A successful preflight is never a real smoke result。

- [ ] **Step 3: Green stop and handoff boundary**

  Store only the `not available` or `blocked` triage outcome in the execution record. Do not claim Story 5.3, Story 5.4, P0 or Epic 5 completion; do not create Orca/GitHub objects, perform remote writes, or generate final `ValidationDecision`。Real smoke is owned by an independent follow-up plan。

- [ ] **Step 4: Commit boundary**

  No commit is produced by Task 4. Any real Orca/GitHub probe or smoke requires a separate approved plan, its own controlled evidence and its own commit boundary。

---
### Task 5: Deferred / E — Story 5.5–5.8 dependency graph only

**Files:**
- No source, test, status, architecture, diagram, adapter or plan files are created/modified。
- Reference only Epic 5, spec, validation contract, architecture spine and inventory。

**Dependency graph:**

```text
5.1 core facts/status
  -> 5.2 lease/worktree/SDD/QC/QA/completion
       -> 5.3 Orca readback --\
       -> 5.4 GitHub readback ----> 5.5 iteration + HostAdapter + control-plane facade
       -> 5.6 local artifact/path/migration -> 5.7 quality/audit/roles/plugin -> 5.8 host/release/knowledge
```

- 5.5 requires 5.1/5.2 and accepted 5.3/5.4 contracts; does not activate hosts or alter control-plane launch。
- 5.6 requires stable JSON/revision/residual contracts; does not replace Orca/GitHub authority。
- 5.7 requires 5.6; product judgment/model choice/Skill selection remain outside engine。
- 5.8 requires 5.5 host evidence, 5.7 gates and real release/observation evidence; 5.5–5.8 are not implemented here。

- [ ] **Step 1: Red dependency checklist** — record predecessor, evidence grade, real-object/permission prerequisite and non-goals for each story。
- [ ] **Step 2: Mechanical prerequisite command**

  ```bash
  bun test packages/harness-engine/tests
  bunx tsc --noEmit -p packages/harness-engine/tsconfig.json
  ```

  Expected: 以执行时新采集的 failure ledger 为准；该次命令显示 zero unresolved failures、当前 Harness 测试和 typecheck 均通过；不作 real smoke 或后续 story 完成声明。

- [ ] **Step 3: Green stop** — leave 5.5–5.8 unimplemented; no status change and no commit。

---

## Verification matrix and stop conditions

| Gate | Command/evidence | Expected | Stop |
| --- | --- | --- | --- |
| Current-failure closure | `bun test packages/harness-engine/tests` plus execution-time failure ledger | 当前命令输出对应的 ledger 中 zero unresolved failures；失败数量和文件分布以本次采集为准 | 任一当前 failure 未归因、未闭环、ledger 不完整或沿用上一轮快照 |
| Harness full | `bun test packages/harness-engine/tests` | 所有本次发现的 Harness 测试通过；新 completion test 仅在实际创建后按自身合同验证，不计入上一轮失败快照 | fail/skip/privacy leak/fake success |
| Harness typecheck | `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` | zero errors | export/type mismatch |
| Control-plane regression | `bun test packages/control-plane`; `bunx tsc --noEmit -p packages/control-plane/tsconfig.json` | existing package tests/typecheck pass | control-plane behavior/history touched |
| OpenSpec | `npx openspec validate --all --strict --json`; if unsupported `npx openspec validate --specs --strict` | existing artifacts validate | requires unapproved spec/architecture edit |
| Diff check | `git diff --check` | clean | WIP/`.omp/`/diagrams/prior plan/control-plane history included |
| Public boundary | inspect `packages/harness-engine/src/index.ts` and imports | stable contracts only; no prompt/transcript/credentials/tool payload | private internals/dynamic task content crosses |
| External real-smoke gate | Task 4 read-only `orca-cli`/`gh` preflight only | Task 4 outputs only `not available` or `blocked`; a viable natural target is handed to an independent real-smoke plan | any real Orca/GitHub smoke, remote write, object creation or real-result claim in this plan |
| Output classification | execution records from Stage 0/5.1/5.2/Task 4 | local mechanical+controlled pass remains acceptance-closure evidence only; Task 4 `not available` or `blocked` means `Partial`/`Draft`/`Blocked`/`Unknown`; only six external gates all pass, including real Orca/GitHub smoke, can produce external acceptance/`Verified`/`active`; MUST NOT claim Epic 5/P0 first-round completion or emit final `ValidationDecision` | any real-result, final-completion or `ValidationDecision` claim is a stop |

The hard stop is execution-time only: any current failure in the newly collected ledger that is unassigned, unclosed, missing a contract reference, not rerun, or missing closure evidence blocks progress. A ledger relying on the previous snapshot also blocks progress; that snapshot is comparison metadata, never a gate-pass record. Recollect status, ownership, test output and the ledger before execution. Do not relax gates, delete tests or convert Unknown to false.

## Failure recovery and concurrent ownership

1. Capture initial diff outside the repository; preserve every concurrent hunk。
2. Use `git worktree list --porcelain` and agent ownership records; treat every path reported by the execution-time capture as pending attribution until its owner is confirmed. Inventory says only “pending-attribution WIP”; it does not fix a count or status。
3. If an unowned file is implicated, do not overwrite it; repair an owned boundary or stop with exact path/error/owner blocker。
4. Re-read a file if it changes before editing; never apply a stale patch。
5. Recover only with surgical non-destructive edits; never reset/revert/clean/restore/checkout。
6. Stage only attributed files; never touch control-plane pushed history。
7. Missing real Orca/GitHub objects/permissions/network stays `not available`/`unknown`/`blocked`; do not create remote objects or widen writes。

## Execution entry

This is a plan only. A later executor may use `subagent-driven-development` or `executing-plans`, run Tasks 1–5 in order and stop at each focused-test/commit boundary. Even if Stage 0/5.1/5.2 mechanical and controlled checks pass, Task 4 is limited to `not available` or `blocked` preflight triage; this plan never executes real Orca/GitHub smoke. Its exit is acceptance-closure evidence only and remains `Partial`/`Draft`/`Blocked`/`Unknown` when real smoke is unavailable or deferred to the independent follow-up plan. It MUST NOT claim Epic 5 or P0 first-round completion and MUST NOT generate a final `ValidationDecision`. The current session only saves this document; it does not implement or commit business code.
