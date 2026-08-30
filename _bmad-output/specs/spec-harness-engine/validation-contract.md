# Harness Engine 首轮验证合同

## 用途边界

本合同只验证新 `harness-engine` 的工作流事实、确定性门禁和 Orca/GitHub 适配。不验证业务任务是否正确，不把 control-plane 的配置装配结果改写为 Harness Engine 成功，也不把 fake adapter 结果写成真实后端支持。

## 证据等级

| 等级 | 证据 | 可以说明 | 不能说明 |
| --- | --- | --- | --- |
| mechanical | 纯函数、schema、golden fixture | 规则和状态机可重现 | 真实后端可用 |
| controlled-integration | 注入端口、受控 Orca/GitHub fixture | 适配器编排和失败边界正确 | 当前账号、网络和宿主真实可用 |
| real-backend-smoke | 真实 Orca/GitHub 只读或有界回读 | 当前版本、当前权限、当前环境的后端行为 | 其他环境长期稳定 |
| real-host-smoke | 真实 OMP/Claude/Codex/OpenCode host | 对应 host 的当前入口和能力 | 跨 host 等价或业务任务收益 |

## 外部硬门与状态优先级

本合同的 `external acceptance`、`Verified`、`active` 和最终验收结论 MUST 以外部可核验证据为准。
领域 Plan `Done` 是本地生命周期状态；BMad Epic/Story `Done` 只是 bookkeeping。二者都不自动等于 external acceptance，仍需六个外部硬门全部 `pass`。

1. 代码实际路径、目标测试与全量测试；
2. failure ledger；
3. worktree/file ownership；
4. independent review；
5. controlled integration；
6. real smoke，或在前置条件不可得时明确记录 `not available`。

BMad 的 `SPEC`、Architecture、Epic 和 `sprint-status` 只能定义范围与预期，不能证明实现、覆盖任何硬门或替代上述证据。

- `sprint-status=done` 只能表示该 Epic/Story 的文档/实现声明已记录；不等于 acceptance `Verified`。任一硬门未通过时，最终状态只能是 `Partial`、`Draft`、`Blocked` 或 `Unknown`；`Done` 不得覆盖、推导或提升为验收通过。
- 所有 P0 MUST 同时具有代码实际路径、目标测试/全量测试、failure ledger、worktree/file ownership、independent review、controlled integration 和 real smoke 证据；external acceptance 要求真实 Orca/GitHub smoke MUST 通过，前置条件不可得时记录 `not available`，但该状态不是 `pass`。fake、fixture、静态文档和 BMad 状态均 MUST NOT 冒充 real smoke。
- 硬门缺失或相互冲突时 MUST fail closed，不得猜测成功。failure ledger 任一当前失败未归因、未重跑或缺少 closure evidence，或只引用旧快照时，同样 MUST fail closed。恢复记录 MUST 同时列出缺失/冲突项、恢复动作、唯一 owner 和补齐后的证据引用；在恢复证据可回读前保持 `Partial`、`Draft`、`Blocked` 或 `Unknown`。

## P0 最小样本

每个 P0 能力至少需要：

- 1 个正常路径；
- 1 个缺字段/缺权限/响应缺失负例；
- 1 个身份或版本不一致负例；
- 1 个 Unknown 或 Blocked 分支；
- 1 个状态不可逆或重复操作负例。

真实 Orca/GitHub smoke 不为了造事故而创建额外任务、PR、worktree 或并发 lease。优先使用自然存在的只读对象；没有合适对象时记录 `not available`，不伪造真实证据。

## 必测合同

### Assignment / dispatch

- 缺 `Execute as`、`Delegation`、`Task category` 任一字段即 fail；
- 可写 Assignment 缺唯一 branch form 即 fail；
- 默认分支无显式例外时即 fail；
- leaf 递归派发、角色字段缺失或不匹配即 fail；
- host capability 为 Unknown 时不进入成功派发。

### Lease / worktree

- plan、branch、worktree、owned paths 不一致即 blocked；
- 同一 plan 的第二 writer 不能取得 execution lease；
- integration merge 同时只能有一个 holder；
- 无法证明旧 lease 失效时不允许强抢；
- Done 时残留 execution lease 即 fail。

### SDD / QC / QA

- 缺 BASE SHA 或 review package 不得进入 QC；
- review range 不等于实际 BASE..HEAD 时 fail；
- `sdd` 至少映射三席，`inline` 才能映射一席；
- reviewer identity、planId、diff basis 不一致即 fail；
- worker_done 不得直接推动 Done；
- residual 必须带 owner、decision、target 和 closure evidence。

### Iteration / PR

- 未完成计划不能进入 Phase 3 close；
- close 未完成不能进入 PR delivery；
- CI 或 AI review 正在当前 head 上运行时 push gate fail；
- PR head 变化后旧 review package、tally 和 merge-ready 结论失效；
- 必需 checks 或 reviews 未满足时不能 merge-ready。

### Orca

- Run、Task、Dispatch、Worker、Delivery 身份必须可关联；
- 跨 Run、重复 delivery、accepted-but-not-executed、失联至少各有一个受控负例；
- Orca 不可读时只返回 Unknown/Blocked；
- 不自动重派、不自动唤醒、不把 TUI 观察面当作事实后端。

### GitHub

- 读取 Issue/PR 当前 head、base、checks、review state；
- 写操作必须绑定 expected head；
- 写后必须回读；
- head 漂移、权限失败或响应形状未知时停止新增写入；
- Project 观察面不能替代 Issue/PR 当前状态。

## 宿主验证

- OMP/Claude：只验证 control-plane facade 接入不改变既有启动合同；
- Codex/OpenCode：首轮只验证 contract、fixture 和 `unsupported | unknown` 诚实状态；
- Cursor/Kimi/ZCode：不进入首轮真实支持声明。

## 通过门

### P0 contract/implementation closure

`P0 contract/implementation closure` 只允许说明 mechanical 与 controlled-integration 的合同闭合，不等同于 external acceptance、`Verified`、`active` 或 P0 external complete。该层要求：

1. mechanical 合同测试通过；
2. controlled-integration 负例通过；
3. 关键 Unknown 没有被删字段、放宽规则或空成功替代；
4. 失败路径包含阶段、原因、证据引用和恢复动作。

### External acceptance / Verified / active

`external acceptance`、`Verified` 或 `active` 必须由以下六个外部硬门全部 `pass` 才能成立。任一门为 `fail`、`blocked`、`unknown` 或 `not available`，都不能形成 external acceptance：

1. **代码与测试门**：代码实际路径可定位，目标 focused tests 与全量 tests 均通过，且结果对应当前代码与当前提交。
2. **failure ledger 门**：failure ledger 必须对应当前命令，且每一行只对应一个当前失败；每行必须记录 `suiteCommand`、`suiteExitCode`、`firstError`、`contractRef`、`owner`、`rerunCommand` 和 `rerunResult`/closure evidence。任一当前失败未归因、未重跑或缺少 closure evidence，或使用旧快照代替当前记录，均不得过门。
3. **ownership 门**：worktree/file ownership 已正向确认 `branch`、`worktree` 和 `owned paths`，不存在待归属 WIP 或冲突写入权。
4. **independent review 门**：review 在 fresh context 中完成，记录 implementer identity、`reviewer identity`、当前 `head`、`review range`、结论和 resolution；`reviewer identity` MUST 与 implementer identity 不同，旧 head 或旧 review package 不得复用。
5. **controlled integration 门**：受控 fixture/injected 结果通过其合同和负例；该结果只能证明 controlled integration，不能提升为 real smoke。
6. **real smoke 门**：真实 Orca 与 GitHub smoke 均通过，并有当前对象、权限、网络和回读证据；`not available` 只是门状态，不是 `pass`，不得填充 external acceptance 分母。

因此，real smoke 未通过或为 `not available` 时，最终状态只能是 `Partial`、`Draft`、`Blocked` 或 `Unknown`，不得标记 P0 external complete。`ValidationDecision` MUST 是引用上述外部证据的独立验收记录，不能由 BMad status 生成。

本合同不允许用测试数量、接入 host 数量、Skill 数量或文档体积作为成功指标。
