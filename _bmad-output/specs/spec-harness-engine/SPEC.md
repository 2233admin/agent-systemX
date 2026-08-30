---
id: SPEC-harness-engine
status: draft
kind: product-spec
companions:
  - validation-contract.md
  - mstar-adoption-map.md
  - ../../planning-artifacts/architecture/architecture-harness-engine/ARCHITECTURE-SPINE.md
---

# Harness Engine 最小性原理规格

## 决策卡

| 项目 | 当前值 |
| --- | --- |
| Driver | 技术寨维护者 |
| Approver | 负责人 |
| Contributors | control-plane、Orca、GitHub、各 Agent host 维护者 |
| Lifecycle | 设计前对齐 |
| Impact | 新增工作流控制面；不改变既有配置控制面合同 |
| Current outcome | 采用独立 `harness-engine` 方向，首轮真实接入 Orca 与 GitHub |

本文是一次新能力域的 BMAD 规格草案。既有 `SPEC-agent-system` 继续约束配置供应、客户端装配和安全启动；本文不覆盖、也不改写其已完成的 OMP/Claude control-plane MVP。

## 1. 问题与背景

技术寨已经具备大量多 Agent 工程治理能力，但能力分布在 BMad 文档、Plugins、一次性 Python 工具、Orca orchestration 和 GitHub Issue/PR 中。当前缺少一个能把以下事实连成可验证状态机的窄运行时内核：

```text
Workflow → Plan → Assignment → Dispatch → Lease/Worktree
         → Worker Delivery → Review Package → QC/QA
         → Integration → PR/Checks → Residual/Close
```

因此目前能做到“有规则”和“有工具”，但不能稳定做到：

- 同一套规则由多个入口复用；
- 跨 Session 读取同一项工作的当前事实；
- 在派发前机械阻止缺少身份、分支、worktree 或 lease 的写入；
- 在 SDD、QC、QA、PR 之间保持同一 `planId`、diff basis 和证据范围；
- 支持多个 Agent host，而不把每个宿主的偶然行为提升为公共语义。

mstar-harness 已经验证了一个可复用方向：把 `dispatch/status/lease/worktree/sdd/iteration/prreview` 做成可导入的确定性 TypeScript engine，同时把判断型流程保留在 skills。我们吸收其结构，不直接复制其状态源、路径约定或宿主生态。

## 2. 最低性原理

### 2.1 必须保留的最小事实

系统只为完成以下判定保存事实：

1. 这项工作是什么：`workflowId`、`planId`、`taskId`；
2. 谁负责什么：`executeAs`、`delegation`、`taskCategory`；
3. 哪个代码面可写：branch、worktree、owned paths；
4. 谁拥有当前写入权：execution lease、integration lease；
5. 哪些阶段已经通过：prepare、execute、review、QA、integration；
6. 哪些结论有证据：delivery、review、checks、residual、close；
7. 哪些内容仍未知：Unknown 与阻塞原因。

超出这些判定所需的数据不进入第一轮核心。

### 2.2 必须由引擎强制的规则

以下规则 MUST 是纯函数或确定性适配器校验，不得只存在于 prompt：

- Assignment 必须有 `Execute as`、`Delegation`、`Task category`；
- 可写任务必须声明唯一 branch/worktree 形式；
- 默认保护分支不能被隐式直接写入；
- 写入前必须验证 plan、worktree、branch 和 lease 对齐；
- leaf executor 不得递归派发同角色或越过权限边界；
- SDD task 完成后必须有 review package；
- `Execution mode` 必须决定 QC seat 数量；
- integration merge 必须串行；
- 未满足 gate 时只能返回 Blocked/Unknown，不能推断成功；
- Done 必须删除对应执行 lease，并绑定最终证据。

### 2.3 不由引擎决定的事情

以下判断仍属于 Agent/负责人，不进入第一轮自动决策：

- 需求是否值得做；
- 采用哪个产品方向；
- 是否扩大授权；
- 是否接受 residual；
- 是否把一个 Skill 组合进某个 profile；
- 一个任务的业务正确性；
- 哪个模型或 Agent host 最优；
- 是否对某个 host 宣布长期支持。

引擎只验证声明是否完整、事实是否对齐、阶段是否允许前进。

### 2.4 多 Agent 支持的最低性原理

支持更多 Agent host 的最小单位不是“复制一套工作流”，而是新增一个 `HostAdapter` 和一组可回读证据。宿主支持按以下顺序逐步激活：

```text
contract → fixture → capability probe → real smoke → active
```

每一步都是独立状态。没有真实 smoke 时可以交付 contract/fixture，但不得把它写成 active。不同宿主可以拥有不同的启动、输入、事件和回执形状；Harness Engine 只统一工程交付门禁，不统一宿主内部语义。

这条规则允许技术寨支持其他 Agent，同时避免一次性承担全部宿主的安装、Session、权限和配置等价成本。

## 2.5 用户任务

| 用户 | 需要完成的动作 | 引擎必须提供的保证 |
| --- | --- | --- |
| 负责人/PM | 让一个 Plan 安全进入执行 | 派发前身份、分支、worktree、lease 和前置条件可机械验证 |
| Worker/Reviewer | 在同一 Plan 上实现并审查 | task、BASE SHA、review package、QC/QA 使用同一身份和 diff basis |
| 交付维护者 | 判断一个 PR 是否可交付 | 当前 head、checks、reviews、residual 和 merge-ready 可重算 |
| Host 维护者 | 接入新的 Agent host | 只新增 adapter、contract test 和 capability evidence，不修改核心门禁 |

## 3. 领域边界

### 3.1 `control-plane` 继续拥有

```text
StableConfigRevision
CapabilityReference
AssemblyManifest
AdapterPlan
OMP / Claude Code launch
content materialization
client capability probe
invocation isolation
secret/privacy allowlist
```

### 3.2 `harness-engine` 新增拥有

```text
Workflow
Plan
Assignment
Task/Dispatch identity
ExecutionLease
Worktree alignment
SDD review package
QC/QA gate
Iteration phase gate
PR review arithmetic
Residual lifecycle
```

### 3.3 Orca 继续拥有实时协调状态

Orca 是 Run、Task、Dispatch、Worker、Delivery 的运行后端。`harness-engine` 不复制 Orca 的实时队列，也不建立第三套 Task/Dispatch 服务。

### 3.4 GitHub 继续拥有远端交付状态

GitHub 是 Issue、PR、review、checks、merge state 的远端交付后端。引擎保存受控引用和校验结果，不把 GitHub 全量内容复制为第二权威。

## 4. 首轮产品范围

### 4.1 P0：工作流事实与门禁

- 创建和读取一个 workflow snapshot；
- 登记 Plan、Task、Assignment；
- 维护 Plan 状态：`Todo | InProgress | InReview | Blocked | Done`；
- 校验 Assignment 字段；
- 校验 branch/worktree/plan 对齐；
- 维护 execution lease 与 integration merge lease；
- 输出结构化 gate result：`pass | fail | blocked | unknown`；
- 输出稳定的 violation code 与恢复建议。

### 4.2 P0：Orca adapter

- 以稳定 ID 读取 Run、Task、Dispatch、Worker、Delivery；
- 校验派发对象与本地 Assignment 的身份一致；
- 消费 `worker_done`、失败和释放回执；
- 识别 accepted-but-not-executed、失联、重复或跨 Run 对象；
- 不自动重派、不自动唤醒、不修改 Orca 状态，除非后续独立合同授权。

### 4.3 P0：GitHub adapter

- 读取 Issue/PR 当前状态、head SHA、base SHA、checks 和 review state；
- 生成与 `planId` 绑定的 review package 引用；
- 只在当前 head、必需 checks、review resolution 和 merge state 满足条件时返回 merge-ready；
- 远端写入采用显式、可回读、按当前 head 绑定的操作；
- 不把 Project 观察面当作授权或事实后端。

### 4.4 P0：SDD/QC/QA

- 从 Plan 生成 Task brief；
- 为每个 task 记录 BASE SHA；
- 生成 `BASE..HEAD` review package；
- `sdd` 默认 QC tri-review；`inline` 才允许 single-seat；
- QC/QA 必须使用同一 `planId`、review range、diff basis；
- residual 必须登记到唯一 register，并有 owner、decision、target 和 closure evidence。

### 4.5 P1：Iteration 与 PR review

第一轮只实现可机械验证的部分：

- iteration compass frontmatter；
- Phase 2 execute、Phase 3 close、Phase 4 PR delivery 的转换门；
- CI/AI review 仍运行时禁止 push；
- PR review 的 tally、score、verdict 可重算；
- merge-ready 的当前 head 绑定。

Phase 1 需求澄清、战略判断、复杂度和价值取舍仍由 BMad/Agent 侧完成。

## 5. 多宿主策略

首轮建立宿主中立接口，不一次性实现所有宿主：

| 宿主 | 首轮状态 |
| --- | --- |
| OMP | 复用现有 control-plane adapter，并接入 host contract |
| Claude Code | 复用现有 control-plane adapter，并接入 host contract |
| Codex | contract、fixture、capability 状态；真实入口单独过 gate |
| OpenCode | contract、fixture、capability 状态；真实入口单独过 gate |
| Cursor/Kimi/ZCode | 只保留扩展点，不进入首轮交付 |

每个 HostAdapter 至少声明：

- host identity 与版本；
- 如何启动或接收 Assignment；
- 如何取得提交/运行证据；
- 如何取得 worker completion；
- 如何表达不可观察状态；
- 如何清理或释放资源。

不同宿主可以有不同实现，但不得把某一宿主的 prompt、hook、Session 或配置语义提升为公共合同。

## 6. 关键接口草案

```text
GateResult =
  | { ok: true; evidence: EvidenceRef[] }
  | { ok: false; violations: Violation[]; recovery: RecoveryAction[] }
  | { ok: false; unknown: UnknownFact[]; recovery: RecoveryAction[] }

CoordinationAdapter:
  getRun(runId)
  getTask(taskId)
  getDispatch(dispatchId)
  getDelivery(dispatchId)

HostAdapter:
  probe(hostContext)
  prepare(assignment)
  observe(operation)
  interpret(observation)

ArtifactStore:
  readWorkflow(workflowId)
  writeWorkflowRevision(expectedVersion, revision)
  readPlan(planId)
  appendEvidence(planId, evidence)
```

第一轮接口不得暴露 prompt、凭据、transcript、工具 payload 或动态任务正文。

## 7. 状态与存储原则

- Orca 实时协调状态不复制；只保存稳定引用、版本、观察时间和结果摘要；
- GitHub 远端交付状态不复制全量正文；保存 head/base/check/review 的 allowlist 证据；
- workflow/plan/gate/residual 的本地事实必须有一个明确 SSOT；
- 第一轮不引入 daemon、队列、轮询器或后台服务；
- 存储实现可先用受控 JSON/SQLite adapter，但领域内核不得依赖具体存储；
- 所有写入必须有 expected version 或等价条件写入；
- Unknown 不得用 `false`、空数组或缺行表示。

## 8. 验收标准

### 8.1 核心门禁

- 缺少 Assignment 必填字段时，派发预检失败；
- 缺少 branch/worktree/lease 时，可写派发失败；
- lease、plan、branch、worktree 不一致时，不能进入 Execute；
- SDD task 没有 BASE SHA 或 review package 时，不能进入 QC；
- QC/QA 的 `planId` 或 diff basis 不一致时，不能进入 Done；
- Done 时仍持有 execution lease 时，状态写入失败；
- 不可观察的 Orca/GitHub 状态返回 Unknown，不推断 success。

### 8.2 Orca 集成

- 同一 Run/Task/Dispatch/Worker/Delivery 身份可被回读并关联；
- 失联、重复、跨 Run、accepted-but-not-executed 至少各有一个确定性负例；
- 工具不可用时返回 Unknown/blocked，不自动重派；
- 正常 `worker_done` 可以推动 Plan 进入 InReview，但不能直接推动 Done。

### 8.3 GitHub 集成

- PR head 变化后旧 review package 和旧 merge-ready 结论失效；
- required checks 未完成时不能返回 merge-ready；
- review 未解决时不能返回 merge-ready；
- 合并后可以回读确认目标分支已落地；
- 远端状态未知时不执行新的写入。

### 8.4 多宿主

- 未实现真实 adapter 的 host 返回 `unsupported` 或 `unknown`，不能返回空成功；
- OMP/Claude 的既有装配行为不因新 engine 接入而改变；
- 新 host 只需实现 HostAdapter，不得修改核心 gate 语义；
- host capability snapshot 绑定 host/version/evidence。

### 8.5 外部验收硬门与状态优先级

本规格中的 `external acceptance`、`Verified`、`active` 和最终验收结论 MUST 服从外部验收证据，不能反向生成外部验收结论。领域 Plan `Done` 是本地生命周期状态；BMad Epic/Story `Done` 只是 bookkeeping，二者都不自动等于 external acceptance，仍需六个外部硬门全部 `pass`。证据优先级（从高到低）固定为：代码实际路径、目标测试与全量测试 → failure ledger → worktree/file ownership → independent review → controlled integration → real smoke/not available。BMad `SPEC`、Architecture、Epic 和 `sprint-status` 只能定义范围与预期，不能证明实现或覆盖硬门。

`P0 contract/implementation closure` 只可说明 mechanical 与 controlled-integration 合同闭合；external acceptance、`Verified`、`active` 必须由六个外部硬门全部 `pass` 才能成立，其中真实 Orca/GitHub smoke 必须通过，`not available` 仅表示门状态而不是 `pass`。任一硬门未通过时，最终状态只能为 `Partial`、`Draft`、`Blocked` 或 `Unknown`，不得把 `Done` 当作覆盖或验收通过。所有 P0 MUST 有代码/测试、failure ledger、worktree/file ownership、independent review、controlled integration 和 real smoke 证据；fake、fixture、静态文档和 BMad 状态 MUST NOT 冒充 real smoke。

`ValidationDecision` 是外部验收记录，必须引用可回读证据，不能由 BMad status 生成。硬门缺失或相互冲突时 MUST fail closed；failure ledger 任一当前失败未归因、未重跑或缺少 closure evidence，或只引用旧快照时，同样不得过门。必须记录缺失/冲突项、恢复动作、唯一 owner 和证据；补齐并核验前保持 `Partial`、`Draft`、`Blocked` 或 `Unknown`。

## 9.1 首轮量化验收门

以下是第一轮工程交付门，不是业务收益承诺：

| 门 | 通过条件 |
| --- | --- |
| Gate determinism | P0 gate fixtures 在相同输入下结果和 violation code 完全一致 |
| Write safety | 所有可写 P0 路径均经过 lease/worktree/branch 校验；未取得 lease 的路径为 0 次成功 |
| Identity integrity | Orca 五类对象与本地引用的身份错配负例全部被阻断 |
| Review integrity | 缺 BASE SHA、review package、QC/QA 或 closure evidence 的 Plan 为 0 次 Done |
| Head freshness | GitHub head 变化后旧 merge-ready 结论为 0 次继续有效 |
| Host extensibility | 新增一个 fixture-only host 不修改核心 domain/gate 文件 |
| Control-plane safety | 既有 control-plane 的测试与 OMP/Claude smoke 无回归 |

没有真实 Orca/GitHub 对象时，真实后端门只能标记 `not available`；不得用 fake/injected 结果填充真实 smoke 分母。

## 9.2 第一轮退出定义

满足以下条件后，Harness Engine 第一轮才可以标记为可继续扩展：

1. P0 领域和适配器合同测试通过；
2. 至少一个真实 Orca 只读回读场景通过；
3. 至少一个真实 GitHub current-head/check/review 回读场景通过；
4. control-plane 既有验证不回归；
5. 所有未取得的真实证据保留为 Unknown 或 `not available`；
6. 没有新增常驻服务、自动重派或第二实时状态源。

否则只能标记为 `Draft`、`Blocked`、`Partial` 或 `Unknown`，不得宣布支持更多宿主或完整工作流交付；`not available` 不满足真实 smoke 退出门。

## 9. 成功信号与反指标

### 成功信号

- 派发前缺陷能在本地确定性阻断，而不是依赖 worker 自己发现；
- 同一个 plan 的实现、审查、QA、PR 证据可回读关联；
- Orca 和 GitHub 仍是各自事实后端；
- 新增一个宿主只新增 adapter 与测试，不复制核心状态机；
- coordinator 恢复 Session 后能从 workflow snapshot 继续，而不依赖旧对话记忆。

### 反指标

- 状态字段数量增长；
- 接入宿主数量增长；
- 自动派发次数增长；
- 文档和 Skill 数量增长；
- Unknown 数量因删字段或放宽门禁而下降。

## 10. Non-Goals

- 不替换 `control-plane`；
- 不复制 mstar 全部 Skill 文本；
- 不复制 Orca 的 Run/Task/Dispatch 实时服务；
- 不建设 daemon、常驻轮询、Webhook 调度器或自动重派；
- 不实现跨宿主配置等价、Session 翻译或任务内容继承；
- 不在首轮一次性支持所有 Agent host；
- 不把 Codex/OpenCode 的 fixture 当作真实支持证据；
- 不自动决定需求价值、模型选择、配置推荐或权限提升；
- 不把 BMad 的规划文档替换成 engine 状态；
- 不以“mstar 兼容”作为产品成功指标。

## 11. 方案权衡

| 方案 | 复杂度 | 与现有 control-plane 隔离 | 复用 mstar 经验 | Orca/GitHub 适配 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 直接 vendor mstar engine | 中 | 中 | 高 | 中 | 不采用，状态与语义耦合风险高 |
| 参考 mstar 重写窄 engine | 中 | 高 | 高 | 高 | **采用** |
| 继续靠 Skill + 一次性工具 | 低 | 高 | 低 | 中 | 不足以解决统一事实与门禁 |
| 并入 control-plane | 高 | 低 | 中 | 中 | 拒绝，边界污染 |

## 12. 触达资产

| asset_id | relation | scope | risk | verify | rollback |
| --- | --- | --- | --- | --- | --- |
| `packages/control-plane` | 保留并复用客户端装配 port | OMP/Claude 配置与启动 | 新 engine 误改变既有启动语义 | 既有 control-plane typecheck、unit、integration、native smoke | 移除 engine adapter 接线，不改配置数据库 |
| `packages/harness-engine` | 新增纯领域与门禁包 | Workflow/Plan/Assignment/Lease/Review | 状态模型与 Orca/GitHub 分叉 | engine contract tests + adapter smoke | 删除新包与接线，保留 control-plane |
| `tools/dispatch_*` | 作为历史行为样本与迁移输入 | dispatch liveness/deadline | 重写时丢失保守边界 | golden fixtures 与负例对照 | 保留旧工具，只切换调用方 |
| Orca orchestration | 真实协调后端 | Run/Task/Dispatch/Worker/Delivery | 运行态 API 漂移 | 版本化 adapter probe 与真实只读 smoke | adapter 返回 Unknown，停止新增写入 |
| GitHub Issue/PR | 真实远端交付后端 | review/checks/merge | head 漂移或权限变化 | current-head readback、required checks、post-merge readback | 停止写入，保留本地证据 |

## 13. Open Questions

1. Harness Engine 的本地事实第一轮采用 SQLite 还是版本化 JSON 文件？默认建议先用领域 port，推迟存储选择到架构阶段；
2. Orca 的最小只读适配 API 是否足以覆盖恢复与身份核验？需要真实 API probe；
3. GitHub 合并动作是否首轮只做 merge-ready 判定，还是包含显式 merge？默认首轮只做判定和回读，合并沿现有交付合同；
4. OMP/Claude 是直接实现 HostAdapter，还是先由 control-plane 提供 launch-scoped adapter facade？默认后者；
5. 是否把 `pr-review` 的评分算法作为第一轮门禁，还是先只接 review state/head/checks？默认先接状态与证据，评分作为 P1。

## 14. Action Items

| Action | Owner | Gate |
| --- | --- | --- |
| 建立 `harness-engine` package 边界与公共类型 | control-plane maintainer | 领域依赖不反向导入 control-plane |
| 为 Orca 建立只读 adapter probe | orchestration maintainer | 真实 ID 关联和 Unknown 负例 |
| 为 GitHub 建立 current-head/readback adapter | delivery maintainer | head/check/review 绑定 |
| 将 dispatch/worktree/SDD 工具行为抽成 golden fixtures | harness maintainer | 旧行为和新 gate 可对照 |
| 形成 HostAdapter contract 与 OMP/Claude facade | host maintainer | 不改变既有装配路径 |
| 编写独立 validation-contract | QA maintainer | 覆盖 P0 验收和真实 smoke |
| 完成 architecture spine 与 epics/stories | architect / product | 负责人批准后进入实施 |
