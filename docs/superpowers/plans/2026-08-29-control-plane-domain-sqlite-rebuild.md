# control-plane Domain 与 SQLite 重构修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不牺牲现有 OMP/Claude 行为的前提下完成 Domain clean cutover、通用 ClientAdapter、单一 SQLite Store、schema history、legacy 保留和 CAS 写入。

**Architecture:** Domain 只拥有配置修订、能力引用、激活 operation、启动 observation 和纯状态转换。Application 只编排窄 ports 与通用 ClientAdapter；客户端特有 materialization、进程和版本探测留在 adapter。单一 SqliteStore 拥有连接、迁移、投影和事务，旧表先保留为审计副本或 inventory。

**Tech Stack:** TypeScript 5.6, Bun 1.3, bun:sqlite, React/Ink TUI, FTS5。

**Spec:** `docs/superpowers/specs/2026-08-29-control-plane-domain-sqlite-rebuild-design.md`

## Global Constraints

- Domain 不导入 Bun、SQLite、文件系统、进程、CLI、adapter 或 Harness。
- 当前有效客户端为 OMP 与 Claude；Codex 不实现。
- 不清空、覆盖或恢复用户全局配置；无法证明隔离时 fail closed。
- 不把 prompt、transcript、凭据、stderr、工具 payload 或任务内容写入 SQLite、日志、receipt 或状态视图。
- 旧 `launch_plan` 全量进入 `legacy_launch_plan`；未知旧阶段不得伪造成失败观察。
- 所有 operation 状态写入使用 expected version；冲突不得覆盖。
- 不保留旧 Domain API、deprecated alias、shim、双写或 TODO stub。

---

### Task 1: 恢复配置查询与 CLI 命令面

**Files:**
- Modify: `packages/control-plane/src/cli/index.ts`
- Modify: `packages/control-plane/src/cli/render.ts`
- Modify: `packages/control-plane/src/application/queries.ts`
- Test: `packages/control-plane/tests/integration/cli.test.ts`
- Test: `packages/control-plane/tests/contracts/config-search.test.ts`

**Interfaces:**
- `list`, `show`, `compare`, `search` 和 `search-rebuild` 必须从 CLI 进入现有 application queries。
- `renderDetail`, `renderList`, `renderSearchResults` 只能渲染 read model，不生成推荐或排序。

- [ ] **Step 1:** 为 `show`、`compare`、`search` 和空状态写 CLI 行为测试，确认未知 revision 返回类型化错误且不会启动或改库。
- [ ] **Step 2:** 恢复 `main()` 的命令分派、参数校验和资源关闭路径；`compare` 保留失败 revision 的显式列表。
- [ ] **Step 3:** 补齐详情中的来源、边界、Unknown、缺失项和 capability 分组字段，避免只显示名称。
- [ ] **Step 4:** 运行对应 CLI/integration tests，确认旧查询合同和新 Domain 类型一致。

### Task 2: 保留 Claude 内容物化与 OMP 隔离

**Files:**
- Modify: `packages/control-plane/src/application/activation.ts`
- Modify: `packages/control-plane/src/application/ports/client-adapter.ts`
- Modify: `packages/control-plane/src/adapters/clients/client-adapters.ts`
- Restore/adapt: `packages/control-plane/src/adapters/clients/claude/adapter-plan.ts`
- Restore/adapt: `packages/control-plane/src/adapters/clients/claude/assembly-manifest.ts`
- Restore/adapt: `packages/control-plane/src/adapters/clients/claude/capability-probe.ts`
- Restore/adapt: `packages/control-plane/src/adapters/clients/claude/content-materializer.ts`
- Restore/adapt: `packages/control-plane/src/adapters/clients/claude/process-port.ts`
- Restore/adapt: `packages/control-plane/src/adapters/omp/process-port.ts`
- Test: `packages/control-plane/tests/application/claude-launch.test.ts`
- Test: `packages/control-plane/tests/adapters/claude-content-materializer.test.ts`
- Test: `packages/control-plane/tests/adapters/process-port.test.ts`

**Interfaces:**
- `ClientAdapter.prepare/start/observe` 使用受控 `PreparedActivation`、`StartedProcess` 和 `ObservedLaunch`。
- Claude adapter 在 `prepare` 内完成 capability probe、manifest/adapter plan 和 invocation-local content materialization；失败按 required/optional 产生 fail-closed 或 degraded。
- OMP 空 capability 必须显式传递 `--no-skills`，并继续使用 launch context/extension 隔离。

- [ ] **Step 1:** 恢复 OMP/Claude adapter contract tests，先固定空 skills、真实 instruction/sourceRef、MCP scope、required materialization 失败和 already-running requires-restart 行为。
- [ ] **Step 2:** 将原 Claude adapter 细节收回 adapter 内部，application 只调用通用 port，不导入 Claude 实现类型。
- [ ] **Step 3:** 将 OMP 启动参数、context writer、native capability probe 和 invocation cleanup 接回通用 adapter 实现；空配置使用 `--no-skills`。
- [ ] **Step 4:** 运行 adapter/application tests，并用 fake process 验证 argv、目录清理和 observation 阶段。

### Task 3: 加固 CAS、沿革和隐私边界

**Files:**
- Modify: `packages/control-plane/src/adapters/sqlite/activation-operation-repository.ts`
- Modify: `packages/control-plane/src/adapters/sqlite/config-revision-writer.ts`
- Modify: `packages/control-plane/src/application/activation.ts`
- Modify: `packages/control-plane/src/domain/launch-observation.ts`
- Modify: `packages/control-plane/src/domain/errors.ts`
- Modify: `packages/control-plane/src/adapters/sqlite/launch-observation-repository.ts`
- Test: `packages/control-plane/tests/contracts/launch-repository.test.ts`
- Test: `packages/control-plane/tests/contracts/config-revision-writer.test.ts`
- Test: `packages/control-plane/tests/integration/activation-flow.test.ts`

**Interfaces:**
- `updateIfVersion(id, expectedVersion, nextState)` 只接受 `nextState.version === expectedVersion + 1`，否则返回 typed conflict/invalid transition。
- supersedes writer 在事务内校验目标存在且 `configName` 相同，唯一冲突转换为 `SupersedesConflictError`。
- `ProcessReference` 只允许有限 `pid` 与 bounded token 字段；未知字段、超长 token 和任意 adapter 错误文本不得进入持久化。

- [ ] **Step 1:** 写 CAS rollback/skip、跨配置 supersedes、恶意 processReference 和含敏感文本 adapter error 的失败测试。
- [ ] **Step 2:** 实现版本单调性、沿革目标校验、processReference allowlist 和稳定错误码/脱敏诊断。
- [ ] **Step 3:** 让 application 仅持久化 bounded reason code，不持久化原始异常消息；CLI 恢复建议仍指向真实命令。
- [ ] **Step 4:** 运行 contracts 与 activation integration tests。

### Task 4: 修正旧状态迁移与坏数据归一化

**Files:**
- Modify: `packages/control-plane/src/adapters/sqlite/store.ts`
- Modify: `packages/control-plane/migrations/0001_canonical.sql`
- Modify: `packages/control-plane/tests/contracts/sqlite-store.test.ts`
- Add: `packages/control-plane/tests/fixtures/real-default-control-plane.sqlite3`（若仓库策略允许提交脱敏 fixture；否则测试运行时复制真实 DB）

**Interfaces:**
- schema history 版本、名称和 checksum 必须严格匹配；legacy bootstrap 只能记录 version 0，不伪造 1–3 已执行。
- 任意仅含未知表的数据库也必须写入 `legacy_schema_inventory`。
- 旧 `failed` 只保留为 operation failed；`observed_outcome=unknown` 不生成 observation；旧 `observing`/`incomplete` 进入可解释的 unresolved/unknown 状态，不改写为失败事实。
- Availability/default/scope 等坏的 known 值归一化为 Unknown，原始值留在 `legacy_launch_plan` 或迁移 manifest。

- [ ] **Step 1:** 增加孤立未知表、未知 phase、incomplete、坏 availability 和重复 Store 初始化测试。
- [ ] **Step 2:** 分离“是否有 legacy 主表”和“是否发现非 canonical 表”的判断；inventory 永远覆盖非 canonical 表。
- [ ] **Step 3:** 实现旧 phase/outcome 的保守映射和坏值 Unknown 归一化，并保证所有复制逻辑在同一迁移事务内。
- [ ] **Step 4:** 在临时数据库副本上运行 migration manifest、行数、hash、FK、projection 和重启验证。

### Task 5: 收口验证与边界审查

**Files:**
- Modify: `packages/control-plane/tests/...`（只补行为缺口）
- Verify: `packages/control-plane/src/**`, `packages/control-plane/migrations/**`, `packages/harness-engine/src/**`

- [ ] **Step 1:** 运行 `bun run typecheck`。
- [ ] **Step 2:** 运行 `bun test`，包含 OMP/Claude adapter、CLI、SQLite contract 和 Harness boundary。
- [ ] **Step 3:** 复制默认数据库，在副本上运行 Store migration smoke，确认原库 checksum 未变化。
- [ ] **Step 4:** 做结构搜索确认无 `Fact<T>`、旧 `LaunchPlan`、`application/ports.ts`、客户端直接写 operation 终态、旧 API alias 或双写路径。
- [ ] **Step 5:** 获取独立 code review，修复所有 P0/P1；再运行最小受影响测试并记录证据。

---

## Spec coverage self-review

- Domain clean cutover：Tasks 2–3；旧 API 删除由 Task 5 结构门禁确认。
- 通用 ClientAdapter 与客户端真实行为：Task 2。
- 窄 application ports、CAS、observation append：Task 3。
- 单一 Store、schema history、legacy inventory/copy、projection separation：Task 4。
- CLI/TUI 高影响确认与真实恢复动作：Task 1–3。
- 默认数据库完整保留、未知值不伪造、真实 smoke：Tasks 4–5。
- 明确不做候选推荐、任务语义、locator、lease、Codex、Harness 内聚：全局约束。
