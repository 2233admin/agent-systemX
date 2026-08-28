---
title: "mstar-harness 能力等价迁移设计规格"
status: approved-design
created: 2026-08-28
updated: 2026-08-28
driver: 负责人
approver: 负责人
scope: "agent-systemX / packages/harness-engine"
---

# mstar-harness 能力等价迁移设计规格

## 决策摘要

本规格把负责人已批准的方案 A 落成可实施的设计约束。迁移目标是让 `packages/harness-engine` 在本仓边界内提供与 mstar-harness 等价的工程交付门禁和事实生命周期；等价指可观察行为、失败语义、证据关联和恢复边界等价，不指源代码、目录布局、默认路径、宿主生态或运行时状态源相同。

方案 A 对调用者呈现一个单一的 `WorkflowFacade` 深模块。调用者不自行拼接 `dispatch`、`lease`、`worktree`、`sdd`、`qc` 或后端调用；Facade 在内部按阶段协调既有领域门禁和适配器，并返回统一的阶段结果、证据引用、Unknown、阻断原因和恢复动作。内部仍保留显式 typed port，以避免 Facade 把不同事实源压成一个未经证明的成功状态。

本设计不把 `harness-engine` 并入 `control-plane`，不复制 Orca 或 GitHub 的事实状态，不引入 daemon、常驻轮询、自动重派或跨客户端语义等价。

## 1. 问题与目标

### 1.1 当前问题

当前工程治理能力分散在 BMad 文档、Plugin、一次性工具、Orca orchestration 和 GitHub Issue/PR 中。已有规则能够描述期望行为，但缺少一条由稳定身份、条件写入、lease、worktree、审查、QC/QA、PR 和 residual 组成的可重算执行链。

当前 `packages/harness-engine` 已有 `core`、`domain`、`gates`、`ports`、`adapters/json`、`cli` 及相应测试目录，形成了领域骨架和本地 JSON 存储。但当前 CLI 只有 `validate` 与 `status`，`src/adapters/` 尚无具体 Orca、GitHub 或 host adapter。Epic 5 在 `sprint-status.yaml` 中仍为 `backlog`；该状态不能被代码目录或测试文件替代。

### 1.2 目标

本设计的目标如下：

1. 以单一 `WorkflowFacade` 隐藏跨阶段协调复杂度，同时保留事实层级和故障域。
2. 将 mstar-harness 中稳定、机械、与具体后端无关的规则转为可测试的 TypeScript 领域能力。
3. 通过 Orca、GitHub 和 Agent host adapter 接入外部事实，不把外部事实复制成第二权威。
4. 使所有本地状态变更经过应用层和条件 `ArtifactStore`，禁止 CLI 或 adapter 绕过授权直接写入。
5. 让每个结论都能区分 `pass`、`fail`、`blocked`、`unknown` 和 `not-available`，并保留来源、时间、作用域与恢复动作。
6. 以六个硬门决定外部验收是否达到 `Verified` 或 `merge-ready`，不以 BMad 状态、worker 退出码或 fake adapter 结果代替真实证据。
7. 保留现有 `control-plane` 对配置、客户端装配和安全启动的所有权，确保 OMP/Claude 既有行为不因接入 Harness 改变。

### 1.3 非目标

本设计不做以下事情：

- 不把 mstar 的 `.mstar` 目录、默认路径或状态树设为本仓事实源。
- 不直接 vendor mstar engine，也不做源代码逐文件复制。
- 不复制 Orca 的 Run/Task/Dispatch 实时队列，不复制 GitHub 全量正文。
- 不让 `harness-engine` 拥有 `StableConfigRevision`、`AssemblyManifest`、客户端配置物化、凭据、transcript 或 Session 内容。
- 不建设 daemon、常驻轮询、Webhook 调度、自动重派或自动唤醒。
- 不一次性激活所有 Agent host，不把 host 的 prompt、hook、Session 或配置语义统一成公共语义。
- 不把需求价值、产品方向、授权扩大、residual 接受、业务正确性、最佳模型或最佳宿主代码化。
- 不把 BMad、mstar、Plugin 或具体方法包升级为 Agent System 的产品本体或成功指标。
- 不将 dsh/OpenCode UI panel 作为首轮引擎核心。

## 2. 能力等价定义

### 2.1 等价的判定对象

每项 mstar 能力按以下五个维度判断：

- **输入等价**：对相同的工作流、计划、任务身份和环境事实，接受同类输入，并拒绝同类非法输入。
- **状态等价**：关键阶段和转换具有同等的单调性、唯一性和阻断条件。
- **结果等价**：通过、失败、阻断、未知和不可用不会被压成同一种结果。
- **证据等价**：结论关联到同等强度的来源、时间、版本、作用域和恢复信息。
- **安全边界等价**：不因适配本仓而放松 ownership、隐私、expected revision/head、lease 或 fail-closed 要求。

以下情况不算能力等价：只复刻命令名称、只生成相似目录、只通过静态 fixture、只返回进程退出码、只把 BMad Story 标为 `done`，或把 fake adapter 的结果写成真实后端支持。

### 2.2 等价等级

- **机械等价**：纯函数、schema、状态机、路径规则、条件写入和 gate 结果可在无外部后端时重算。
- **受控集成等价**：注入的 Orca/GitHub/Host port 能表达成功、失败、失联、重复、身份不一致和不可观察边界。
- **真实后端等价**：当前版本、当前权限和当前自然存在对象上的 Orca/GitHub/Host smoke 可回读，且没有把不可用写成通过。
- **运营等价**：发布、doctor、迁移、质量、知识和观察能力在本仓有明确归属、证据和回滚；没有因存在上游功能就自动承诺迁移。

## 3. 范围矩阵

| mstar 能力 | 处理方式 | 首轮范围 | 本仓落点与边界 |
| --- | --- | --- | --- |
| `core`：Result、Evidence、Unknown、severity、enforcement | 直接迁移语义 | P0 | `src/core`；保持 `Known`/`Unknown` 和封闭 GateResult，不携带私密内容 |
| `workflow`：snapshot、生命周期、branch anchors | 直接迁移并本地化 | P0 | `src/domain/workflow`；增加 Orca/GitHub 引用，不复制其状态 |
| `lease`：execution/integration lease、条件写锁、steal 规则 | 直接迁移状态机，后端证明经 adapter | P0 | `src/domain/lease`；无法证明 stale 时 `blocked`，不强抢 |
| `dispatch`：Assignment、branch gate、QC seat、anti-recursion | 直接迁移机械规则 | P0 | `src/gates/dispatch`；Orca 身份由 `CoordinationAdapter` 提供 |
| `worktree`：路径、分支、plan 对齐 | 直接迁移规则，路径语义本地化 | P0 | `src/gates/worktree`；不照搬 `.mstar` 默认路径 |
| `sdd`：task brief、BASE SHA、review package | 直接迁移规则，证据改用本仓 delivery | P0 | `src/gates/sdd`、`src/domain/review` |
| `path`、`status`、`conventions`、`artifacts` | 迁移行为并改为 repo-local | P0 | 版本化 `ArtifactStore`；不得成为新的远端事实源 |
| `mstar-review-qc`、`qa` | 直接迁移机械门，判断留在负责人/Agent | P0 | gate/application；必须绑定 `planId`、review range、diff basis |
| `iteration`、`prreview` | 直接迁移可重算部分 | P1 | Phase 2/3/4、tally、score、verdict；不重造 GitHub 权限语义 |
| `Orca`：Run/Task/Dispatch/Worker/Delivery | adapter 改造 | P0 | `CoordinationAdapter` 与 `adapters/orca`；只读稳定身份和回执，不复制实时队列 |
| `GitHub`：Issue/PR/checks/reviews/merge | adapter 改造 | P0 | `DeliveryAdapter` 与 `adapters/github`；当前 head 绑定，写后回读 |
| `host`、OMP、Claude、Codex、OpenCode | adapter 改造 | P0/P1 | `HostAdapter`；OMP/Claude 经 `control-plane facade`，Codex/OpenCode 先保持 `unsupported | unknown` |
| `roles`、`lint`、`audit`、`skill-authoring`、`agent-plugins` | 选择性迁移机械检查 | P1 | 与现有 Plugin registry/conformance 合并，不复制 Skill 正文 |
| `migrate`、`init/doctor`、release checks | 本仓适配 | P1 | 只处理 repo-local 产物、安装检查和发布验证，不默认改用户配置 |
| `project`、`compound`、`mstar-compound-refresh` | 选择性迁移 | P1/P2 | 仅在真实使用价值明确后接入，Project 仍为观察面 |
| `design-md`、UI panel | 仅作参考 | P2 | 不进入首轮引擎核心；观察层不能成为事实后端 |
| mstar prompt/Skill 原文、默认宿主生态 | 仅作设计参考或禁止 | 不迁移 | 由现有 Plugins、BMad 和各 host reference 按本仓合同管理 |
| `.mstar` 状态树、全量宿主一次性激活、自动重派、daemon | 禁止 | 不迁移 | 与当前 SSOT、后端所有权和安全边界冲突 |

## 4. control-plane、harness-engine 与 SSOT

### 4.1 control-plane 所有权

`packages/control-plane` 继续唯一拥有：

- `StableConfigRevision`、`CapabilityReference`；
- `AssemblyManifest`、`AdapterPlan`；
- OMP/Claude Code 的启动、配置应用和内容物化；
- 客户端 capability probe；
- invocation isolation、secret/privacy allowlist；
- OMP/Claude 客户端装配的产品事实。

Harness 不导入 control-plane 内部 domain、SQLite repository 或实现细节。需要读取配置或请求宿主能力时，只使用公开、版本化的 `ControlPlaneFacade` DTO。

### 4.2 harness-engine 所有权

`packages/harness-engine` 只拥有工程交付生命周期：

- `Workflow`、`Plan`、`Assignment`；
- Task/Dispatch identity 的本地关联；
- execution/integration lease；
- branch/worktree alignment；
- SDD review package；
- QC/QA 与 iteration gate；
- PR review arithmetic；
- residual 生命周期；
- 本地 artifact 的 schema、revision、证据索引和投影。

### 4.3 外部事实源

- **Orca** 是 Run、Task、Dispatch、Worker、Delivery 的事实后端。Harness 只读取、关联和解释，不能复制实时队列或自行重派。
- **GitHub** 是 Issue、PR、checks、reviews、merge state 的事实后端。Harness 只保存 allowlist 引用和校验结果，不能复制全量正文。
- **Agent host** 拥有 prompt、transcript、credentials、tool payload 和原生 Session 内容；这些字段不能越过 adapter 进入 engine artifact。

### 4.4 ArtifactStore 与 WorkflowFacade

首轮本地事实由版本化 JSON `ArtifactStore` 保存。它是 Workflow/Plan/Gate/Lease/Residual 的 SSOT，不是 Orca/GitHub 的替代品。

`WorkflowFacade` 是外部调用的唯一组合入口。它至少提供以下语义操作，而不要求调用者自行拼接内部 gate：

- 创建或读取 workflow snapshot；
- 登记 Plan、Task、Assignment；
- 准备并校验执行；
- 协调 lease、worktree、dispatch、review、QC/QA 和 PR 交付；
- 追加 completion、failure、residual 和 delivery evidence；
- 查询当前状态并返回恢复动作。

Facade 内部可调用现有 `src/domain`、`src/gates` 和 typed ports，但不得把 `pass` 视为真实后端成功，也不得以一个总状态覆盖各阶段事实。

## 5. 分阶段数据流

### 5.1 总体数据流

```text
WorkflowFacade command
  → load local ArtifactStore snapshot
  → validate identity / assignment / branch / worktree
  → claim execution or integration lease
  → run deterministic local gates
  → call Orca/GitHub/Host adapters for scoped evidence
  → reconcile identity, version, head, hashes and event ordering
  → append conditional local revision/evidence
  → render status, recovery and remaining Unknown
```

`WorkflowFacade` 可返回一个统一的阶段结果，但必须保留各阶段的事实和证据引用，不能把 adapter 的 `configured`、`accepted` 或进程退出码提升为 `Done`。

### 5.2 阶段切分

#### Stage 0：设计审批与基线冻结

冻结本规格、`SPEC-harness-engine`、`architecture-harness-engine`、ownership、failure ledger、golden fixtures、当前 head 和验证分层。未明确 owner、SSOT、恢复动作和停止条件时，不进入真实接线。

#### Stage 1：Facade 与受控本地写入

把 CLI 的直接 `JsonArtifactStore` 构造、synthetic defaults、synthetic host capability 和 synthetic lease 路径收敛到 `WorkflowFacade`。所有写入携带 actor、operation、expected revision 和输入摘要；原始 writer 不对外暴露。

#### Stage 2：P0 机械门禁

闭合 `core/path/status/workflow/assignment/lease/dispatch/worktree/sdd/QC/QA`。每个门提供稳定 violation code、Unknown 原因、恢复动作和确定性负例。Plan 只有在任务回收、BASE..HEAD review package、QC/QA、residual closure、delivery evidence 和 lease 释放均成立时才能进入 Done。

#### Stage 3：受控适配器

实现 Orca、GitHub 和 Host 的 typed ports 及注入式 fixture。每个 adapter 只返回 allowlist DTO、来源、版本、观察时间和 Unknown；不传播 prompt、transcript、credentials、tool payload 或未脱敏 stderr。

#### Stage 4：真实后端回读

使用自然存在的 Orca/GitHub 对象执行默认只读或有界回读 smoke。验证当前版本、权限、网络、身份关联、跨 Run、重复、失联、accepted-but-not-executed、head 漂移和写后回读。不可用时记录 `not-available`，不创建额外任务、PR、worktree 或 lease 来制造样本。

#### Stage 5：control-plane facade 与宿主接入

通过公开 facade 接入 OMP/Claude，检查既有配置装配和安全启动无回归。Host 状态严格按 `contract → fixture → capability probe → real smoke → active` 推进；Codex/OpenCode 在真实证据不足时保持 `unsupported | unknown`。

#### Stage 6：P1/P2 资产

在 P0 真实闭环稳定后，再按价值接入 iteration、PR review、project、migrate、quality、audit、roles、plugin、doctor、release、compound、knowledge 和 observation。每项能力独立拥有 contract、测试、证据和回滚，不因映射表中存在就自动进入实现。

#### Stage 7：独立验收

由 fresh reviewer 在当前 head 上生成 review package，绑定实现者、审查者、`base..head`、source hash、evidence manifest 和六硬门。只有六门全部 `pass`，并且 Orca/GitHub real smoke 均 `pass`，才能形成 `Verified`/`merge-ready`。

## 6. 错误、Unknown、隐私与 ownership 约束

### 6.1 错误与 Unknown

所有跨边界结论使用封闭结果：`pass | fail | blocked | unknown`。外部依赖尚未可用时可额外记录 `not-available`，但它永远不是 `pass`。

Unknown 必须包含原因码、观察时间、证据范围和恢复动作。禁止用 `false`、空数组、缺字段、进程退出码零或文件存在表示未知或成功。

以下情况必须 fail closed 或保持阻断：

- 必需 Assignment、branch、worktree、lease、BASE SHA、review package 或证据缺失；
- plan、workflow、lease、head、review range 或 adapter identity 不一致；
- Orca/GitHub/Host 无法读取或返回未识别形状；
- 无法证明 stale lease 已失效；
- real smoke 缺失却试图宣布 active 或 Verified；
- 当前 head 变化后继续使用旧 review package 或 merge-ready 结论。

### 6.2 隐私与内容所有权

engine artifact 只保存类型化引用、稳定 ID、来源、版本、摘要、hash、状态和 evidence reference。prompt、transcript、动态任务正文、凭据、工具参数/结果、私域原文和未脱敏 stderr 不得进入 ArtifactStore、日志、projection、receipt 或 facade DTO。

`control-plane` 的 invocation-local 内容只由 control-plane 和客户端 adapter 在调用作用域内处理。Harness 不读取或持久化客户端 Session 内容，不把配置装配内容复制成自己的资产库。

### 6.3 Ownership 与写入

文档中的 ownership inventory 不是 runtime lock。runtime lock 由 application 层通过 execution/integration lease 强制。所有本地写入必须经过 `WorkflowFacade` 和带 expected revision 的 `ArtifactStore` 条件写入；所有 GitHub 写操作必须绑定 expected head 并在写后回读。

同一对象只能有一个可写权威。Facade、adapter、projection、TUI 和 CLI 都不能绕过 owner 直接改写外部或本地事实。

## 7. 测试设计与六硬门

### 7.1 测试层级

1. **机械单元与合同测试**：覆盖 Result、Unknown、schema、状态转换、Assignment、branch/worktree、lease、SDD、QC/QA、iteration、PR arithmetic 和 ArtifactStore 条件写入。
2. **golden fixture 测试**：每类 gate 至少包含正常、缺失、冲突、重复、失联、过期、不可观察和恢复样本；序列化输出可重复。
3. **受控集成测试**：注入 Orca/GitHub/Host port，覆盖身份关联、accepted-but-not-executed、跨 Run、重复 delivery、head drift、权限未知和 adapter 错误。
4. **真实后端/宿主 smoke**：使用当前自然存在对象，记录版本、权限、网络、时间、作用域和读后证据；不可用时写 `not-available`，不伪造通过。
5. **回归测试**：Harness 接入后，`control-plane` 的配置修订、OMP/Claude 装配、安全启动、内容物化和隐私 allowlist 行为不得改变。

### 7.2 六个外部硬门

每个硬门必须有当前 `head`、`sourceHash`、typed `evidenceRefs` 和 `failureRefs`。六门名称固定为：

1. **`code-tests`**：代码路径、类型/schema、单元/合同/受控测试和 golden fixtures 完成；不存在未归因的当前失败。
2. **`failure-ledger`**：所有当前失败有唯一 owner、rerun command、rerun result 或 closure evidence；零失败使用明确的空失败结构；旧快照不能替代当前记录。
3. **`ownership`**：当前 branch、worktree、owned paths、实现者、未跟踪项和冲突路径可回读；不存在重叠写入或未归属 WIP。
4. **`independent-review`**：审查者与实现者身份不同，review package 绑定实际 `base..head`；未解决 major finding 阻断，minor/info 必须有解决或明确接受理由。
5. **`controlled-integration`**：注入式 Orca/GitHub/Host adapter 的合同和负例通过；明确 controlled 结果不能冒充真实后端支持。
6. **`real-smoke`**：当前 Orca 与 GitHub real smoke，以及已声明 host 的真实 probe/smoke 证据可回读；`not-available`、fake、fixture、退出码零和静态文档都不算通过。

`ValidationDecision` 只有在六门全部 `state=pass`，且 Orca 与 GitHub real smoke 均为 `pass` 时才能是 `Verified`。任一门为 `fail`、`blocked`、`unknown` 或 `not-available`，结果只能是 `Partial`、`Draft`、`Blocked` 或 `Unknown`。

## 8. 风险与回滚

| 风险 | 触发信号 | 控制措施 | 回滚方式 |
| --- | --- | --- | --- |
| 范围膨胀 | mstar 资产逐项变成产品承诺 | 每项能力先过本仓价值、边界和 owner 审查 | 保留映射，撤销未激活的新增能力 |
| 双重事实源 | `.mstar`、Orca/GitHub、ArtifactStore 同时可写 | 固定 SSOT 表和 facade/adapter 边界 | 删除本地投影，不回写外部事实 |
| 证据压平 | fake、退出码或 BMad `done` 变成成功 | 封闭状态、evidenceRefs、六硬门 | 标记 non-Verified，追加 failure row |
| adapter 语义泄漏 | Orca/GitHub/host 字段进入公共 domain | DTO allowlist 和独立端口 | 回滚 adapter，保留契约与 fixture |
| 隐私泄漏 | artifact 或日志出现 prompt、凭据、transcript | schema allowlist、secret scan、内容不落盘 | 停止外部写入，删除本次 invocation-local 工件并保留脱敏证据 |
| 并发覆盖 | stale revision/head、重复 lease、head 漂移 | expected revision/head、lease、幂等 reconcile | 只回滚引入回归的本地 source commit，不重写历史证据 |
| 真实后端不可用 | Orca/GitHub/host 返回 `not-available` | 保持 `Unknown/Blocked`，不创建伪造样本 | 停止 acceptance，不把不可用项填入通过分母 |
| control-plane 回归 | OMP/Claude 装配或启动行为变化 | facade 仅消费公开 DTO，运行回归 smoke | 移除 Harness 接线，保留 control-plane 原有路径 |

回滚原则是保留 immutable evidence、failure ledger 和来源 artifact，只撤销引入行为回归的本地 source commit。不得强制 reset、删除他人 WIP、清理外部 Session、删除 Orca/GitHub 对象或恢复 synthetic defaults。

## 9. 未决但不阻塞项

以下问题不阻塞本设计进入实现，但必须在对应阶段形成记录：

1. 首轮 `ArtifactStore` 继续使用 JSON 的具体目录名和投影文件命名；只要 SSOT、schemaVersion、revision 和原子写入语义不变，可在实现阶段确定。
2. GitHub 写操作的最小范围和具体 API 载荷；首轮可以先完成只读回读，再依据公开授权启用 expected-head 绑定写入。
3. Orca 当前可自然读取的对象集合和具体事件回执形状；不可读取时使用 `not-available` 证据，不改变合同。
4. OMP/Claude HostAdapter 的版本 pin、capability snapshot 和 smoke 命令；在真实环境探测前不得把文档声明写成 `supported`。
5. `project`、`compound`、`design-md`、UI observation 和 release/doctor 的优先级；由真实使用价值和前置依赖决定，不影响 P0 gate。
6. 是否在未来把 evidence ledger 增强为完整 append-only event sourcing；当前只要求可审查的证据引用和条件 ArtifactStore，不预先承诺完整事件重放架构。
7. `SPEC-harness-engine` 和 `architecture-harness-engine` 当前仍是设计阶段产物；实现前需要完成独立能力域审批，但不需要为选择性吸收 mstar 重开 agent-system 主 PRD。只有当 Harness 改变主产品用户承诺、control-plane 所有权或既定非目标时，才重新打开主 PRD/架构决策。

## 10. 实施前自检结论

- 未使用未完成占位符，所有要求均有明确处理方式或停止条件。
- 迁移范围与 mstar adoption map 的四批顺序一致，并明确了直接迁移、adapter 改造、仅参考和禁止项。
- `control-plane` 与 `harness-engine` 的所有权不重叠；Orca 和 GitHub 仍为外部事实后端。
- 方案 A 的单一 Facade 只作为调用边界，不取消内部 typed ports、证据分层或故障域。
- 未把当前代码目录、测试文件或 BMad `backlog/done` 状态写成验收通过。
- `not-available`、fake、fixture、退出码零和静态文档均不能进入 `Verified` 结论。
- 现有 Agent System PRD 的非目标没有被静默扩大；新增 Harness Engine 继续作为独立能力域推进。
