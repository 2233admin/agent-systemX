# Agent System MVP 首轮验证合同

> **用途边界。** 本合同是 OMP 侧 MVP 开发的**外部验收方法**，用于团队判断 OMP 侧交付是否达标；不是 MVP 产品向终端用户暴露的运行时功能。当前 OMP 侧已激活排期为 Epic 1～3，由 [`epics.md`](../../planning-artifacts/epics.md) 权威定义，见其 AR15 对三层验证/样本门的裁决。本合同的 T-1～T-5 任务集合、可比性键与 SM 指标只适用于 OMP 客户端；Epic 4（Claude Code adapter）不套用本合同，也不能由本合同推导出 Claude Code 已通过验收。Epic 4 的证据按下方独立 parity gate 管理。

## Epic 4（Claude Code）的独立 parity gate

Epic 4 是已激活但独立于 OMP 核心 MVP 的第二客户端能力域。其验收不复用本合同的 T-1～T-5 样本门或 SM 指标，而按 Story 4.1～4.7、Architecture Spine AD-19～AD-21 以及对应 spec 中的 adapter 合同单独核验：

1. **Adapter 合同门：** 真实 Claude Code native surface probe、确定性 manifest/plan、fresh target 的 launch/interpret，以及 already-running target 只能得到 `requires-restart`；能力状态、事实层级、失败关闭和内容所有权必须可回读。
2. **内容与 parity 门：** 对已声明的真实装配意图核验 Instructions/Skills/MCP 的调用作用域物化、最终 argv/生成文件和差异；`.cap/` 退役前的两个真实 profile parity 证据与运行时依赖核实仍以 Story 4.5/4.5b/4.7 的独立记录为准。
3. **真实客户端边界：** fake/injected ports 的集成测试只能证明 control-plane 编排和物化合同，不能替代真实 Claude interactive launch、任务执行或外部任务验收。原生版本/help probe 也不能替代这些证据。

当前证据分层必须保持诚实：`_bmad-output/implementation-artifacts/validation-report-2026-08-27.md` 记录了本机 Claude Code 版本/help probe 通过，以及 Claude 相关测试使用 fake/injected ports；报告明确没有执行真实 Claude interactive launch，因此 Claude 的真实客户端/任务验收结论保持 **Unknown / not run**。Story spec/retro 中记录的 adapter 与 `.cap/` parity 证据是该独立 gate 的分层证据，不得改写为本合同的 OMP `Verified`，也不得据此声称 Claude 已通过本合同验收。

## 任务集合

| Task | 任务 | 首轮验收重点 |
| --- | --- | --- |
| T-1 | 产品需求产出：从已批准 Brief 生成中文 PRD | 来源覆盖；FR 可验收；无需求扩张；不提前固化架构。 |
| T-2 | 官方来源技术核验 | 使用多个合适的官方来源；事实与推论分离；证据可回读；不宣称未经证明的跨平台等价。 |
| T-3 | 有界代码修复 | 以公开、自足 Issue 为合同；已知复现消失；合同验收与必要验证通过；没有范围扩张。 |
| T-4 | Web UI 变更 | 仅在没有合适 T-3 时替代；必须记录替代理由并使用与 UI 表面相称的真实验证。 |
| T-5 | 暂缓 | 不进入首轮样本；只有新合同明确激活后重开。 |

## 最小样本门

- 首轮使用 T-1、T-2、T-3；没有合适 T-3 时才使用 T-4，并记录理由。
- 每项任务至少记录 1 个当前基线样本和 2 个稳定配置样本。
- 每项任务至少 1 个稳定配置样本必须来自 fresh 或明确不同的原生 Session；`fresh` 在这里仅表示样本来自一次新建的 native Session，不表示 Agent System 提供 locator 或 resume 产品能力。
- 基线和稳定配置样本使用同一验收口径；任何已知差异必须记录。

## 当前 MVP 不纳入的外部目标态 gate / Future reactivation gate

- 当前版本 MVP 不实现 explicit resume，不持久化 opaque native Session locator，也不实现 lease-fencing；`fresh → 取得 opaque locator → explicit resume` 链在本合同中标为 `N/A / Deferred`，不进入当前 MVP acceptance pass denominator。
- 该链保留为未来目标态/重新激活条件。只有新证据与负责人明确裁决后，才可重开为外部 gate；在此之前不得把目标态要求倒灌为当前产品、样本或升级门。

## 可比性

样本只有以下键可比时才能进入同一组：

1. 任务类型；
2. 验收口径与结构；
3. 输入可比性：可重复任务使用等价输入；不可重复的一次性任务使用相同输入分类/结构及到同一验收口径的映射，实际输入内容或指纹只记录、不要求相等；
4. 配置无关的 OMP 客户端身份、版本与环境能力证据；
5. 已知外部变化。

任一可比性键不兼容时必须拆组，不能通过聚合隐藏环境变化。每个样本还必须记录：实际声明输入引用/指纹、基线/稳定配置类别、稳定配置修订与 Assembly Manifest hash、capability/隔离结果、`fresh` 样本来源与 native Session 关系、如有则记录目标态 resume 关系（当前 MVP 未实现时记为 `N/A / Deferred`）、`operationId`、Adapter Plan、Launch Receipt、正式验收结果、任务期装配干预、无关上下文、期望与观察差异、失败类型和 Unknown；这些是被比较自变量或分层字段，不要求相等但必须展示差异。`observationStage = planned | launched` 不得与 `observed | verified` 合并为同级事实；`validationMethod` 独立记录，不得复用 observationStage。

## 成功指标

| Metric | 定义 | 首轮判定 |
| --- | --- | --- |
| SM-1 | 首次正式验收通过率 | 先建立基线；量化接受门槛由负责人在最小样本后确定。 |
| SM-2 | 任务期装配干预率 | 相对基线下降；量化接受门槛由负责人在最小样本后确定。 |
| SM-3 | 无关内容数、无关能力数及其出现率 | 三项分别记录并相对基线下降；量化接受门槛由负责人在最小样本后确定。 |
| SM-4 | 装配可解释率 | 所有接受候选的 manifest、plan、receipt、差异、残留来源与 Unknown 均可关联，达到 100%。 |
| SM-5 | 三层证据完备率 | 所有宣布 `Verified` 的配置均为 100%，且启动退出码不单独计为验证证据。 |
| SM-6 | 普通复用激活负担 | 逐项能力选择为 0；重复输入为 0；产品确认至多 1 次；配置切换通过新 operation 重启生效；explicit resume 不属于当前 MVP 要求。 |

## 反指标

- **SM-C1 — 维护活动量：** 配置数、修改次数或 Skill Discovery 次数增加不代表产品价值。
- **SM-C2 — 能力数量：** Instructions、Skills、MCP 或其他能力越多不代表配置更好。
- **SM-C3 — 人为降低 Unknown：** 不得通过省略 Unknown 或降低证据要求抬升表面通过率。

## 首轮退出规则

完成最小样本后只能作出以下一种决定：

1. **接受：** 当前稳定配置和边界进入普通复用；
2. **调整：** 由具名证据推动有界配置修订，再按同一合同复验；
3. **停止：** 证据不支持继续投入或能力不适用；
4. **追加一次采样：** 仅用于区分一个具名 Unknown，且预先说明该样本如何改变决定。

达到最小样本门后，才允许以 append-only 方式追加不可变的外部 `ValidationDecision`，绑定稳定配置修订、可比样本组、证据、负责人裁决与理由。`ValidationDecision` 是外部验收记录，不是 MVP 的 SQLite/API/CLI 能力。追加样本仍无区分力时必须升级负责人决定，不能继续无限采样；决定和证据必须跨 Session 可追溯，被替代决定不得静默改写。

目标态 explicit resume/opaque locator/lease-fencing 链在当前版本为 `N/A / Deferred`，不算失败；不得为了填补该缺口生成伪造的 `ValidationDecision`，也不得在样本门尚未达到时提前追加该记录。
