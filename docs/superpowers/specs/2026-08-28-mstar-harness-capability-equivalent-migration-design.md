---
title: "mstar-harness 能力等价迁移设计规格"
status: review
created: 2026-08-28
updated: 2026-08-28
driver: 负责人
approver: 负责人
scope: "agent-systemX / packages/harness-engine"
---

# mstar-harness 能力等价迁移设计规格

## 决策摘要

本规格把 mstar-harness 的可复用能力改写为 agent-systemX 可使用、可验证、可回滚的本仓合同。迁移目标不是把上游代码、目录或运行时整体搬进来，而是逐项把上游语义转换为本仓合同，再由本仓实现或 adapter 落地。只有完成这三个层次的转换，才称为能力等价：

```text
mstar semantics
  → agent-systemX contract
  → implementation / adapter / evidence
```

采用已批准的方案 A：对外以单一 `WorkflowFacade` 作为深模块，调用者不自行拼接 `dispatch`、`lease`、`worktree`、`sdd`、`qc` 或后端调用。Facade 内部仍使用显式 typed ports 和独立 domain/gates，避免把不同事实源、阶段和故障结果压成一个未经证明的成功状态。

`packages/control-plane` 与 `packages/harness-engine` 保持两个能力面。control-plane 拥有稳定配置、客户端装配和安全启动；harness-engine 拥有工程交付生命周期；Orca 与 GitHub 继续拥有各自的实时或远端事实。mstar 的 `.mstar` 状态树、默认路径、全部宿主、prompt/Skill 原文、自动重派和 daemon 不进入本仓 SSOT 或首轮产品。

本文件处于 `review`，表示设计规格仍需书面规格审批；它不改变 BMad 权威文件，不授予实现授权。

## 1. 问题与目标

### 1.1 当前问题

当前工程治理能力分散在 BMad 文档、Plugin、一次性工具、Orca orchestration 和 GitHub Issue/PR 中。它们拥有规则或工具，却缺少一条可重算的工作流事实链：

```text
Workflow → Plan → Assignment → Dispatch → Lease/Worktree
         → Worker Delivery → Review Package → QC/QA
         → Integration → PR/Checks → Residual/Close
```

当前 `packages/harness-engine` 已有 `core`、`domain`、`gates`、`ports`、`adapters/json`、`cli` 和测试目录，但实现仍是领域骨架与本地 JSON/CLI 阶段。当前 CLI 只有 `validate` 与 `status`；`src/adapters/` 只有 JSON 存储，没有具体 Orca、GitHub 或 host adapter。Epic 5 在 `sprint-status.yaml` 中仍为 `backlog`，不能用代码目录、测试文件或 BMad 状态冒充外部验收完成。

### 1.2 目标

1. 以 `WorkflowFacade` 隐藏多阶段协调复杂度，同时保留阶段事实、证据和故障域。
2. 将 mstar 的稳定机械规则转换为本仓可重算的 domain/gates 合同。
3. 将依赖 Orca、GitHub、Windows、本地文件系统、权限和具体 Agent host 的部分改造为 typed adapter 合同。
4. 建立明确的 canonical persistence schema、条件写入、并发恢复和幂等证据追加方向。
5. 保证 control-plane 的配置事实与 harness-engine 的工程交付事实不重叠、不互相写入内部数据库。
6. 用可执行的阶段 inputs/outputs/gates 和六个硬门决定 `Verified`/`merge-ready`。
7. 保持所有不可证明事实为 `Unknown`、`Blocked` 或 `not-available`，不以退出码、文件存在或 BMad 状态提升证据等级。

### 1.3 非目标

- 不直接 vendor mstar engine，不进行源代码逐文件迁移。
- 不把 `.mstar` 目录、mstar 默认路径或其状态树设为本仓事实源。
- 不复制 Orca 实时队列、GitHub 全量正文或 Agent host 的 prompt/transcript/credentials/tool payload。
- 不把 `harness-engine` 并入 `control-plane`，不共享 control-plane 内部 domain 或 SQLite repository。
- 不一次性激活所有 Agent host，不统一不同 host 的 prompt、hook、Session、权限或配置语义。
- 不建设 daemon、常驻轮询、Webhook 调度、自动重派或自动唤醒。
- 不把需求价值、产品方向、授权扩大、residual 接受、业务正确性或最佳模型/宿主代码化。
- 不把 BMad、mstar、Plugin 或具体方法包定义为 agent-system 的产品本体或成功指标。
- 不将 dsh/OpenCode UI panel、完整 knowledge/compound 生命周期作为首轮引擎核心。

## 2. “不是搬运，是本仓化重实现”的决策原则

### 2.1 三段映射原则

每个 mstar 能力必须形成以下三列映射，缺少任一列就不能进入实现：

| mstar semantics | agent-systemX contract | implementation / adapter / evidence |
| --- | --- | --- |
| 上游解决的工程问题、状态、约束或失败语义 | 本仓保留什么、改变什么、拒绝什么，以及结果状态和证据要求 | 本仓模块、typed port、schema、fixture、smoke 和回滚证据 |

映射遵循四条规则：

1. 保留的是可验证的行为语义，不保留上游偶然的目录名、默认值、宿主假设或实现语言细节。
2. 依赖外部事实的语义必须落在 adapter；domain 只消费稳定 DTO、事实来源和 `Unknown`。
3. 与本仓 SSOT、权限、隐私、Windows 或 Orca/GitHub ownership 冲突的上游假设必须明确改写或拒绝。
4. 只有在实现、受控集成和真实证据层次均有落点时，才允许将该能力标为 active。

### 2.2 迁移矩阵

| 能力族 | 保留语义 | 改变语义 | 不可保留语义 | 验收证据 |
| --- | --- | --- | --- | --- |
| `core` / `status` | 封闭结果、severity、Unknown、fail-loud | 结果字段绑定本仓 `operationId`、来源和时间 | 用空值、空数组或退出码表达 Unknown | domain/contract fixtures；序列化两次结果一致 |
| `workflow` / `plan` | 生命周期、branch anchors、依赖和完成门 | 统一为本仓 `WorkflowSnapshot` canonical schema | 依赖 mstar 文件名或隐式全局状态 | 状态转换负例、schema validator、revision CAS |
| `lease` | execution/integration lease、stale 保护、fencing 语义 | 通过本仓 ArtifactStore 和本机进程证据实现 | 无证明强抢、用进程内 mutex 代替跨进程事实 | 并发 fixture、stale/second-writer 负例、恢复证据 |
| `dispatch` | Assignment 完整性、branch/worktree 对齐、anti-recursion | 接入本仓 Orca identity 和 host capability | 直接按 mstar 默认 branch 或角色名推断权限 | dispatch gate tests、Orca identity fixture、real readback |
| `worktree` | 可写路径和分支对齐、孤儿/冲突可见 | 适配 Windows 路径、盘符、空格、长路径和 junction 规则 | 假设 POSIX 路径、固定 `.mstar` 根或静默规范化越权路径 | Windows-safe path fixtures、真实 worktree readback、拒绝越界 |
| `sdd` / `mstar-review-qc` | BASE SHA、review package、QC seat、residual closure | 使用本仓 `planId`、review range、diff basis 和 reviewer identity | `worker_done` 直接等于 Done；未绑定 diff 的泛化审查 | review package validator、QC/QA negative cases、independent review |
| `iteration` / `prreview` | 阶段门、push cadence、tally/score/verdict 可重算 | GitHub 状态通过 DeliveryAdapter 获取，权限语义留给 GitHub | 复制 GitHub Project 为授权源或自造 merge 权限 | head/check/review fixtures、head drift 失效、真实回读 |
| `path` / `conventions` / `artifacts` | 产物生命周期、可定位和可迁移 | 使用 repo-local、可配置 control-root 和 Windows-safe 路径 | 强制 `.mstar` 目录和上游默认布局 | path escape fixtures、迁移幂等、恢复/回滚证据 |
| `Orca` | Run/Task/Dispatch/Worker/Delivery 身份关联和回执 | 只读稳定对象和 allowlist 观察，按本仓 correlation fields 关联 | 复制实时队列、自动重派、自动唤醒 | controlled fixtures + 当前对象 real smoke + 回读 |
| `GitHub` | Issue/PR/check/review/merge 交付事实、当前 head 约束 | 只保存引用和校验结果；写操作按 expected head 授权 | 复制全量正文、把 Project 当授权或 SSOT | head/check/review readback、expected-head 写后回读 |
| `host` | 宿主 capability、启动/完成/不可观察状态 | 以 `HostAdapter` 按 host/version/evidence 独立激活 | 一次性激活全部 host、跨 host 配置/Session 等价 | contract→fixture→probe→real smoke→active |
| `roles` / `lint` / `audit` / `plugin validate` | 机械质量、secret/supply-chain 和角色一致性检查 | 与现有 Plugin registry/conformance 合并 | 复制 Skill 正文、把价值/审美/模型判断代码化 | typed findings、secret non-disclosure、独立复核 |
| `migrate` / `init/doctor` / release | 初始化、迁移、安装和发布可验证性 | 只处理本仓 repo-local 产物和发布链 | 修改用户全局配置、把安装成功当 capability verified | 幂等迁移、doctor negative cases、release smoke |
| `compound` / knowledge / UI | 作为后续维护和观察参考 | 只有真实使用价值成立才接入 | 观察面成为事实后端、复制私域/Session 内容 | 独立价值裁决、scope/overlap 检查、观察证据 |

## 3. 必须改写的 mstar 假设

### 3.1 `.mstar` 路径与状态源

mstar 的路径约定只能作为语义来源，不能成为本仓路径合同。本仓使用 repo-local、可配置的 control-root 与版本化 JSON `ArtifactStore`。路径解析必须接受 Windows 盘符、反斜杠、空格、非 ASCII、长路径和 junction/symlink 边界；路径越界或根外引用必须 fail closed 或明确 `Unknown`。

Workflow/Plan/Gate/Lease/Residual 的唯一本地事实是 `ArtifactStore` 中的 canonical persisted aggregate。JSON/Markdown projection、命令输出、TUI、ownership 文档和 evidence bundle 都是派生或审计载体，不得成为可写第二权威。Orca 和 GitHub 的事实仍分别属于它们自己。

### 3.2 宿主假设

mstar 的宿主生态不直接搬入。每个 host 必须独立拥有 `HostAdapter`、host identity、版本、能力探测、输入/启动/完成/清理语义和 evidence scope。激活顺序固定为：

```text
contract → fixture → capability probe → real smoke → active
```

首轮只接入 OMP/Claude 的 control-plane facade；Codex/OpenCode 没有真实证据时保持 `unsupported | unknown`；Cursor/Kimi/ZCode 只保留扩展点。

### 3.3 Orca/GitHub ownership

Orca 继续是 Run、Task、Dispatch、Worker、Delivery 的实时后端；GitHub 继续是 Issue、PR、checks、reviews、merge state 的远端后端。Harness 只能通过 `CoordinationAdapter`/`DeliveryAdapter` 读取、关联、解释和追加受控证据，不能建立第三套实时服务，也不能把外部全量内容复制进本地 SSOT。

任何 GitHub 写操作必须有明确授权、`expectedHead`、写前读取、写后回读和幂等 operation；未能证明当前 head 或权限时不得写入。Orca 不提供自动重派或自动唤醒语义，Harness 不得自行补上。

### 3.4 Windows 假设

mstar 中可行的 POSIX 路径、进程、锁和 shell 习惯不得直接作为本仓合同。Windows 适配必须显式处理：

- drive letter、UNC、反斜杠和大小写比较；
- 空格、非 ASCII 和长路径；
- junction/symlink 根外指向；
- 原子临时文件替换、文件锁和锁恢复；
- 进程存活、退出、权限错误和文件占用；
- 不经 shell 的 argv、cwd、env、stdio 和取消传播。

无法证明路径、锁或进程状态时返回 `Unknown`/`Blocked`，不能以 POSIX 经验推断成功。

### 3.5 权限假设

mstar 的角色、默认 branch、宿主权限和本地执行权限不自动转化为本仓授权。权限来源必须是当前合同、当前 actor、当前 host capability、当前 GitHub/Orca 返回和可回读 evidence。`ownership.json` 或文档声明只是审计记录，不是 runtime lock；runtime lock 由应用层 lease 和 expected revision/head 强制。

### 3.6 JSON ArtifactStore 假设

JSON 是首轮持久化实现，不等于“任意 JSON 文件都可写”。canonical 方向固定为：

```text
typed domain command
  → application authorization
  → canonical persisted aggregate
  → versioned JSON serialization
  → allowlist projection / query view
```

不得反过来从人类 CLI 输出、Markdown 或可编辑 projection 推导权威状态。每次写入必须携带 `expectedRevision`；写入由同一聚合范围内的临时文件原子替换完成；跨进程冲突返回类型化冲突而非覆盖。只有在真实多 writer、查询或恢复压力出现并完成新决策后，才可增加 SQLite adapter；不能因为 control-plane 使用 SQLite 就共享数据库。

## 4. Facade、边界与 canonical persistence schema

### 4.1 `WorkflowFacade` 的 typed commands

`WorkflowFacade` 是外部调用边界，不是无界的“协调一切”函数。公开操作使用 typed command，且每个 command 绑定 actor、operation、目标、输入摘要和条件版本：

- `createWorkflow(CreateWorkflowCommand)`
- `readWorkflow(ReadWorkflowQuery)`
- `registerPlan(RegisterPlanCommand)`
- `registerAssignment(RegisterAssignmentCommand)`
- `prepareExecution(PrepareExecutionCommand)`
- `claimExecutionLease(ClaimExecutionLeaseCommand)`
- `dispatch(DispatchCommand)`
- `reconcile(ReconcileCommand)`
- `appendCompletionEvidence(AppendCompletionEvidenceCommand)`
- `closePlan(ClosePlanCommand)`
- `queryStatus(StatusQuery)`

每个 command 的返回值必须包含 `operationId`、`stage`、`result`、`evidenceRefs`、`failureRefs`、`unknownFacts` 和 `recoveryActions`。调用者不能把 `result=pass` 当作真实后端成功；真实后端能力必须在对应 adapter evidence 中单独表达。

### 4.2 Facade 内部 seam

Facade 内部按以下顺序调用 domain、gates 和 ports：

```text
command
  → identity/authorization validation
  → read canonical aggregate
  → deterministic local gates
  → claim lease if side effect is allowed
  → call scoped adapter
  → reconcile correlation/head/hash/order
  → conditional append to ArtifactStore
  → return phase result and remaining Unknown
```

CLI 是组合根；Facade 是应用用例边界；domain 不导入 Bun、SQLite、文件系统、Orca、GitHub 或 control-plane 内部实现；adapter 不拥有产品状态或自行选择终态。

### 4.3 Canonical persisted schema 方向

本仓的 canonical persisted aggregate 至少需要能表达以下结构化对象，不得只依赖 `PlanRow.metadata`：

| 对象 | 必要关联与事实 |
| --- | --- |
| `WorkflowSnapshot` | `schemaVersion`、`revision`、`workflowId`、`updatedAt`、plan references、workflow-level evidence index |
| `Plan` | `planId`、`workflowId`、status、branch/worktree、base/head、dependencies、plan revision |
| `Task` / `Assignment` | task identity、`executeAs`、delegation、task category、host identity、owned paths、branch form |
| `Lease` | lease kind、resource key、holder、owner operation、fencing token、claimed/released evidence |
| `GateResult` | gate name、state、violation codes、recovery actions、evidence refs、observedAt |
| `EvidenceRef` | source、locator、observedAt、scope、content/hash reference；不含原文秘密 |
| `ReviewPackage` | plan/task、reviewer identity、concrete `base..head`、diff basis、findings、resolution evidence |
| `Residual` | residual ID、owner、decision、target、status、closure evidence |
| `Operation` | operation ID、command kind、target resource key、idempotency key、stage、terminal outcome |

JSON 文件可以把这些对象序列化为一个按 `workflowId` 分区的 aggregate，或按明确的 append-only 子记录存储；两种形式都必须遵守同一 canonical schema、revision CAS、allowlist 和重建规则。projection 只能从 canonical aggregate 派生，不能回写成权威。

### 4.4 Adapter correlation fields

所有 `CoordinationAdapter`、`DeliveryAdapter`、`HostAdapter` 的请求、响应和 evidence envelope 必须携带或可关联：

- `requestId`、`operationId`、`workflowId`、`planId`、`taskId`；
- 外部对象 ID，如 `runId`、`dispatchId`、`workerId`、`deliveryId`、`issueRef`、`prRef`；
- `source`、`sourceVersion`、`observedAt`、evidence locator/scope；
- `baseSha`、`headSha`、`expectedHead`、`diffBasis`（适用时）；
- `capabilityStatus`、`reasonCode`、`retryable`、`authorizationScope`；
- `manifestHash`、`artifactManifestHash` 或等价输入摘要（适用时）。

适配器不得返回未定义的动态字段、未脱敏 stderr、prompt、transcript、credentials、工具载荷或全量外部正文。重复、迟到、跨 Run、hash/head 不匹配和不可观察响应必须成为可关联的 `Unknown`/`Blocked`，不得更新错误的本地事实。

## 5. 分阶段数据流、输入、输出与 gate

| 阶段 | 输入 | 输出 | 必须通过的 gate | 停止条件 |
| --- | --- | --- | --- | --- |
| Stage 0 设计审批与基线 | 本规格、SPEC、architecture、当前 head、ownership、failure ledger | 批准记录、golden fixtures、owner 和 evidence manifest 起点 | 范围、SSOT、owner、回滚和证据分层明确 | 有未归属 WIP、冲突权威或当前失败未归因 |
| Stage 1 Facade 与 guarded write | typed command、actor、input digest、canonical snapshot | authorization result、revision CAS、无 bypass 的 Facade path | 所有写入经 application；无 synthetic default；raw writer 不公开 | CLI 可直接构造 writer、缺 expected revision 或用默认值掩盖 Unknown |
| Stage 2 P0 机械门 | canonical aggregate、本地 gate input、golden fixtures | GateResult、PlanCompletion、violation/recovery、revisioned artifact | Assignment、branch/worktree、lease、dispatch、SDD/QC/QA、Done 条件可重算 | 必要事实缺失仍返回 pass；重复 owner；Done 仍持 lease |
| Stage 3 受控 adapter | versioned port contracts、sanitized fixtures、correlation fields | controlled evidence、adapter failure/Unknown、reconcile result | Orca/GitHub/Host 成功与负例均只证明 controlled integration | adapter 传播动态载荷、返回无法关联结果或自动执行未授权副作用 |
| Stage 4 真实后端回读 | 自然存在 Orca/GitHub 对象、当前权限和网络 | current object readback、real-smoke evidence、not-available evidence | 当前身份、跨 Run、重复、失联、accepted-but-not-executed、head drift 可回读 | 创建额外对象制造样本；not-available 被算 pass |
| Stage 5 control-plane facade 与 host | control-plane public DTO、OMP/Claude host context、版本 probe | host capability snapshot、真实/未知状态、回归证据 | OMP/Claude 既有行为无回归；host 按五步状态机激活 | 导入 control-plane 内部实现；没有 real smoke 却 active |
| Stage 6 P1/P2 资产 | 已完成 P0、真实价值和前置 evidence | iteration/PR/project/migrate/quality/release/knowledge 等独立能力 | 每项拥有自己的 contract、测试、evidence、owner、rollback | 因上游存在就默认实现；观察面变成 SSOT |
| Stage 7 独立验收 | 当前 head/range、fresh reviewer、六门证据包 | `ValidationDecision`、`Verified`/`merge-ready` 或非通过状态 | 六门全部 pass，Orca/GitHub real smoke pass | 任一门 fail/blocked/unknown/not-available，停止宣布通过 |

### 5.1 依赖关系

```text
Stage 0
  → Stage 1
    → Stage 2
      → Stage 3
        → Stage 4
Stage 1 + Stage 3
  → Stage 5
Stage 2 + Stage 3 + Stage 4 + Stage 5
  → Stage 6
Stage 0–6
  → Stage 7
```

Stage 2 可使用本地和受控 fixture 闭合机械规则，但不能因此改变真实后端或 host 的状态。Stage 3 的 controlled evidence 不能替代 Stage 4。Stage 5 的 control-plane facade 是接缝，不是把 control-plane 状态复制到 Harness。Stage 6 的 P1/P2 能力必须逐项验收，不得用全量清单代替证据。

## 6. 错误、Unknown、隐私与 ownership

### 6.1 状态与错误

跨边界结果采用封闭集合：`pass | fail | blocked | unknown`；外部条件不可得可记录 `not-available`，但它不是 `pass`。每个 `Unknown` 必须带 `reasonCode`、`observedAt`、scope/evidenceRef 和 recovery action。

以下情况必须 fail closed 或保持阻断：必要字段/lease/review package/head/evidence 缺失；plan、task、identity、hash 或 revision 不一致；无法证明 stale lease 已失效；外部响应形状未知；真实 smoke 缺失却要宣布 active/Verified；迟到或重复 evidence 试图覆盖既有事实。

### 6.2 隐私

ArtifactStore、projection、日志、receipt、adapter envelope 和诊断只允许保存稳定 ID、类型化引用、来源、版本、摘要、hash、状态和 evidence reference。不得保存 prompt、transcript、credentials、动态任务正文、工具参数/结果、私域原文或未脱敏 stderr。control-plane 的 invocation-local 内容和客户端 Session 仍由 control-plane/host 拥有。

### 6.3 Ownership 与并发

`ownership` 记录用于审计，不替代 runtime lock。应用层必须使用 execution/integration lease、holder、fencing token、target resource key 和 expected revision/head。ArtifactStore 的写入必须是条件写入；同一资源的第二 writer 在无法证明前一 writer 已失效时返回 `blocked`，不得强抢。

同一 command 的重复提交必须由 `operationId + idempotencyKey` 得到相同可回读结果或明确冲突；迟到、重复、冲突或 hash 不匹配的 evidence 只能追加为 uncorrelated `Unknown`，不得反写历史事实。

## 7. 测试与六个硬门验收

### 7.1 测试层级

- 机械单元与 schema/contract tests：验证 domain/gates、canonical schema、revision CAS、Unknown 和禁止字段。
- golden fixtures：每个 gate 覆盖正常、缺失、冲突、重复、失联、过期、不可观察和恢复样本；序列化两次结果一致。
- controlled integration：注入 Orca/GitHub/Host ports，验证 correlation、identity、head、权限、失败和幂等边界。
- real backend/host smoke：只使用自然存在对象，记录当前版本、权限、网络、作用域、时间和回读结果；不可用写 `not-available`。
- control-plane regression：验证配置修订、OMP/Claude 装配、启动、物化、隐私 allowlist 无回归。

### 7.2 六硬门记录字段

每个 `HardGateResult` 必须是结构化记录，至少包含：

```text
name: code-tests | failure-ledger | ownership | independent-review
      | controlled-integration | real-smoke
state: pass | fail | blocked | unknown | not-available
currentHead
sourceHash
artifactManifestHash
evidenceRefs
failureRefs
owner
observedAt
command
scope
dependsOn
```

`evidenceRefs` 和 `failureRefs` 必须是可回读的 typed references，不能只存人类字符串。每门的 `currentHead`、`sourceHash` 和 scope 必须与同一验收 bundle 一致。

六门为：

1. **`code-tests`**：代码路径、类型/schema、单元、合同和 golden fixtures 完成，没有未归因当前失败。
2. **`failure-ledger`**：每个当前失败有 owner、rerun command、rerun result 或 closure evidence；零失败使用明确空失败结构。
3. **`ownership`**：当前 branch、worktree、owned paths、实现者、未跟踪项和冲突项可回读，无重叠 writer。
4. **`independent-review`**：审查者不同于实现者，review package 绑定实际 `base..head`；未解决 major finding 阻断。
5. **`controlled-integration`**：注入式 Orca/GitHub/Host adapter 的成功和负例通过，且明确不提升为真实后端支持。
6. **`real-smoke`**：当前 Orca、GitHub 和已声明 host 的真实 probe/smoke 可回读；`not-available`、fake、fixture、退出码零和静态文档均不算通过。

只有六门全部 `pass`，且 Orca/GitHub real smoke 均 `pass`，才允许生成 `Verified`/`merge-ready`。任何一门为 `fail`、`blocked`、`unknown` 或 `not-available`，最终状态只能是 `Partial`、`Draft`、`Blocked` 或 `Unknown`。

## 8. 风险与回滚

| 风险 | 触发信号 | 控制措施 | 回滚方式 |
| --- | --- | --- | --- |
| 上游语义误搬 | 出现 mstar 默认路径、状态或 host 假设 | 逐项执行三列映射并记录改变/拒绝语义 | 保留来源映射，撤销未激活本仓实现 |
| Facade 上帝对象 | command 可任意协调全部阶段，返回一个大结果 | typed commands、operation scope、阶段结果和内部 typed ports | 回滚 facade 接线，不恢复旁路 writer |
| 双重事实源 | `.mstar`、projection、Orca/GitHub、ArtifactStore 同时可写 | 固定 canonical schema 和 ownership 表 | 删除派生 projection，不回写外部事实 |
| 并发覆盖 | stale revision/head、锁被误删、重复 operation | CAS、owner token、fencing、idempotency 和 reconcile | 只撤销引入回归的本地 source commit，保留 evidence |
| adapter 语义泄漏 | 动态载荷或宿主字段进入公共 domain | versioned DTO、allowlist、correlation fields | 回滚具体 adapter，保留 contract/fixture |
| Windows 不一致 | POSIX 路径或文件锁在 Windows 上误判 | Windows-safe fixtures、真实路径/锁 smoke、fail closed | 禁止该 host/路径激活，保留 Unknown/Blocked |
| 验收造假 | fake、fixture、退出码或 BMad status 被算 real/Verified | 六硬门 typed records、当前 head/hash 和 real-smoke 分项 | 标记 non-Verified，追加 failure ledger |
| 隐私泄漏 | artifact/log 中出现 prompt、凭据、transcript | schema allowlist、secret scan、调用期内容隔离 | 停止外部写入，清理调用期文件，保留脱敏 evidence |
| control-plane 回归 | OMP/Claude 装配或启动事实变化 | 只走 public facade，保留 control-plane regression gate | 移除 Harness 接线，不改变 control-plane SSOT |

回滚不得强制 reset、删除他人 WIP、删除 Orca/GitHub 对象、清理客户端 Session 或恢复 synthetic defaults。失败证据、failure ledger、来源 artifact 和已批准合同必须保留。

## 9. 未决但不阻塞项

1. JSON aggregate 的具体文件拆分、目录名和 projection 命名；canonical schema、revision CAS 和原子替换语义不变即可在实现阶段确定。
2. GitHub 写操作的最小授权范围与具体 API 载荷；首轮可先完成只读回读，未授权写入保持 `Blocked`。
3. Orca 可自然读取对象的具体集合和回执名称；不可读时记录 `not-available`，不改变 adapter 合同。
4. OMP/Claude HostAdapter 的版本 pin、capability snapshot 和 smoke 命令；真实 probe 前不得写 `supported`。
5. P1/P2 中 `project`、`compound`、`design-md`、UI observation、release/doctor 的排序；由真实使用价值和前置证据决定。
6. 是否把 evidence index 进一步演进为完整 append-only event sourcing；当前 canonical aggregate + evidence references 已足够，不预先承诺完整事件重放。
7. `SPEC-harness-engine` 与 `architecture-harness-engine` 的独立审批记录和 Epic 5 激活时点；本规格处于 `review`，不把设计状态写成实现或验收通过。

## 10. 规格自检

- frontmatter 已从 `approved-design` 调整为 `review`。
- 已明确“mstar semantics → agent-systemX contract → implementation/adapter/evidence”三列映射。
- 已逐项写出保留语义、改变语义、不可保留语义和验收证据。
- 已明确 `.mstar`、宿主、Orca/GitHub ownership、Windows、权限和 JSON ArtifactStore 必须如何本仓化。
- `WorkflowFacade` 已改为 typed commands，并规定 operation、授权、幂等和阶段结果边界。
- 已补 canonical persistence schema 方向、adapter correlation fields、阶段 inputs/outputs/gates 和六硬门记录字段。
- 未将 control-plane、harness-engine、Orca、GitHub 或 host 的 SSOT 混为一体。
- 未将 fake、fixture、退出码、目录存在或 BMad 状态当作真实验收证据。
- 未修改产品代码或 BMad 权威文件；本文件仅记录设计约束，书面规格批准前不授权实现。
