# Control-plane Human Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通用户能够发现、启动并完成 `configs` 首轮配置使用，并让错误输出只呈现可行动的人话，不泄露内部 reason。

**Architecture:** 保持 `packages/control-plane` 作为唯一外部 TypeScript/Bun CLI 和组合根。帮助、usage、错误渲染和首跑说明只复用现有 CLI 分派、i18n、render、SQLite 状态路径、supply/establish 管道与现有测试端口，不引入新的事实后端、daemon 或统一 Harness 入口。

**Tech Stack:** TypeScript、Bun、`bun:test`、现有 SQLite adapters、现有 OMP/Claude client adapters；新增或实质修改的代码注释使用中文。

**Spec:** `_bmad-output/specs/spec-agent-system/SPEC.md`、`_bmad-output/specs/spec-agent-system/validation-contract.md`、`_bmad-output/planning-artifacts/epics.md`、`_bmad-output/planning-artifacts/architecture/architecture-agent-system-2026-08-22/ARCHITECTURE-SPINE.md`

## Global Constraints

- 外部产品入口仍是 TypeScript/Bun `configs` CLI；不新增 Go、Rust、Python sidecar、Shell 产品脚本、服务或 daemon（SPEC Constraints；Architecture Spine AD-2）。
- 当前实施面只覆盖 OMP Epic 1～3 与已独立激活的 Claude Code Epic 4；Codex CLI 继续 Deferred，不新增 `codex` adapter（epics.md、Architecture Spine AD-1）。
- 不清空、覆盖、备份恢复或改写用户全局 OMP/Claude 配置；继续使用隔离 invocation root、显式覆盖和现有 allowlist（SPEC Constraints；Architecture Spine AD-6/AD-9）。
- 期望装配、plan、receipt、观察、差异和 Unknown 继续分层；退出码、参数传入或帮助探测不能冒充 `verified`（SPEC Constraints；Architecture Spine AD-8）。
- 不生成配置推荐、评分、排序或静默 fallback；用户仍亲自选择具体 revision，启动最多一次产品确认（epics.md MVP-FR3/MVP-FR4/NFR7）。
- 不解析、持久化或打印 prompt、transcript、凭据、私域原文、工具 payload 或动态任务内容（SPEC Constraints；Architecture Spine AD-6）。
- 默认用户输出只包含 allowlist 后的人话、阶段、受影响能力和恢复动作；内部 `Error.message`、schema 字段路径、文件系统异常和 adapter reason 不进入 stdout/stderr。
- 不把 `packages/harness-engine` 接成统一产品入口；不修改 README、`docs/` 或 Harness 文件。

---

### Task 1: 加入 `--help`/`-h` 与分组 usage

**Files:**
- Modify: `packages/control-plane/src/cli/index.ts:141-145,612-651,1250-1279`
- Modify: `packages/control-plane/src/cli/i18n.ts:115-161` 及英文对应表
- Create: `packages/control-plane/tests/cli/help.test.ts`
- Modify: `packages/control-plane/tests/integration/cli.test.ts`

**Interfaces:**
- Consumes: `usageLine()`、`parseCommand()`、`main()`、`t()`、`CliOverrides`。
- Produces: 纯函数 `renderHelp(topic?: HelpTopic): string` 与 `isHelpArg(value: string): boolean`；help 路径在 `openDeps()` 前返回 0，不创建 SQLite。

- [ ] **Step 1: 写红测试**

在 `help.test.ts` 沿用 `version.test.ts` 的 console 捕获和临时 `CONTROL_PLANE_DB_PATH`。断言 `main(['--help'])`、`main(['-h'])` 返回 0，输出包含“查看与比较”“选择与启动”“供给与修订”“示例”以及 `configs use <id> --client omp --yes`，且 DB 不存在。再断言 `main(['list', '--help'])`、`main(['use', '--help'])`、`main(['supply', '--help'])` 返回 0，分别包含命令 usage、必填参数和示例；`main(['show'])` 仍返回 2。

- [ ] **Step 2: 运行红测试**

Run: `bun test packages/control-plane/tests/cli/help.test.ts`

Expected: FAIL；当前 `--help` 被当作未知命令，命令级 help 会继续打开空数据库，失败原因正是帮助行为尚未实现。

- [ ] **Step 3: 实现最小帮助路径**

在 `index.ts` 保留现有 `USAGE_SYNTAX`，增加 `HelpTopic = 'root' | 'inspect' | 'activate' | 'assemble'`、`isHelpArg()` 和纯 `renderHelp()`。分组内容固定为查看/比较（`list/show/compare/search/status`）、选择/启动（`use/switch/--client/--yes`）、供给/修订（`supply/establish/revise`）和环境状态（`CONTROL_PLANE_DB_PATH`、`CONTROL_PLANE_SUPPLY_ROOT`、空状态）。在 `main()` 的零参数/version/parse 前分支识别根帮助；在 `parseCommand()` 识别合法命令后的唯一 help flag；所有分支都在 `openDeps()` 前返回。

- [ ] **Step 4: 添加 zh/en 文案并运行绿测试**

在两个 i18n 字典加入分组标题、usage、示例、环境变量和恢复说明，命令名/flag/闭合枚举保持原文。Run: `bun test packages/control-plane/tests/cli/help.test.ts packages/control-plane/tests/integration/cli.test.ts`。Expected: PASS，既有 usage/退出码不回归。

- [ ] **Step 5: 类型检查**

Run: `bun run --cwd packages/control-plane typecheck`。Expected: exit 0，翻译 key 集合完整。

---

### Task 2: 公开错误 formatter 与内部 reason 隔离

**Files:**
- Modify: `packages/control-plane/src/cli/render.ts:245-324`
- Modify: `packages/control-plane/src/cli/i18n.ts:131-183` 及英文对应表
- Modify: `packages/control-plane/src/cli/index.ts:1263-1279,1386-1389`
- Create: `packages/control-plane/tests/cli/error-rendering.test.ts`
- Modify: `packages/control-plane/tests/integration/cli.test.ts`
- Modify: `packages/control-plane/tests/integration/cli-supply.test.ts`

**Interfaces:**
- Consumes: `QueryOrEstablishError`、`assertNeverErrorKind()`、`renderQueryFailure()`、`renderLaunchFailure()`、`t()`。
- Produces: 穷尽的 `formatPublicFailureReason(error: QueryOrEstablishError): string`；默认输出不插入 `ConfigUnsupportedError.reason`、`InvalidCandidateError.reason`、`SupplySourceUnreadableError.reason` 或裸 `Error.message`。

- [ ] **Step 1: 写红测试**

构造 `InvalidCandidateError('INTERNAL_SENTINEL_schema.path_and_stack')`、`ConfigUnsupportedError('rev-1', 'INTERNAL_SENTINEL_storage')` 和供给源不可读错误，调用 `renderQueryFailure()`，断言输出有人话和恢复动作但不含 sentinel、schema path、OS 异常或绝对私域路径。通过 `main()` 覆盖仓储打开失败和顶层意外错误，断言 stdout/stderr 不含原始 stack、prompt、凭据和 `Error.message`。

- [ ] **Step 2: 运行红测试**

Run: `bun test packages/control-plane/tests/cli/error-rendering.test.ts packages/control-plane/tests/integration/cli.test.ts packages/control-plane/tests/integration/cli-supply.test.ts`

Expected: FAIL；现有 `formatErrorReason()` 会直接渲染部分 `error.reason`，顶层文案会插入内部 message。

- [ ] **Step 3: 实现公开错误映射**

在 `render.ts` 将 `formatErrorReason()` 改为 `formatPublicFailureReason()`，继续使用 `switch` 与 `assertNeverErrorKind()`。`config-unsupported` 只显示版本/引用/存储不可解析的类别；`invalid-candidate` 只显示候选 JSON 结构或字段不合法及首跑恢复；`supply-source-unreadable` 只显示供给内容不可读取及检查目录/权限的恢复；`supply-unsupported-entry` 只显示 allowlist 的相对标识；`openDeps.failed` 与顶层 unexpected 使用固定阶段和恢复文案。`renderQueryFailure()` 仍保持标签、类型化失败、恢复建议结构；supply 失败继续 stderr，stdout 为空。内部 reason 仍留在错误对象，不新增 debug flag 或日志后端。

- [ ] **Step 4: 运行绿测试**

Run: `bun test packages/control-plane/tests/cli/error-rendering.test.ts packages/control-plane/tests/integration/cli.test.ts packages/control-plane/tests/integration/cli-supply.test.ts`。

Expected: PASS；错误类别、退出码、stdout/stderr 流向和 sentinel 非泄露全部通过。

- [ ] **Step 5: 类型检查**

Run: `bun run --cwd packages/control-plane typecheck`。Expected: exit 0，所有新增注释使用中文。

---

### Task 4: CLI 回归测试与真实 OMP smoke

**Files:**
- Create: `packages/control-plane/tests/integration/cli-human-usable.test.ts`
- Modify: `packages/control-plane/tests/omp/real-omp-smoke.test.ts`
- Modify: `packages/control-plane/tests/integration/cli-claude-launch.test.ts`

**Interfaces:**
- Consumes: `main()`、`CliOverrides`、`SqliteConfigRevisionRepository`、现有 fake ports、`buildOmpArgv()`、`defaultExtensionPath()`。
- Produces: 临时环境下可复核的 CLI 合同和真实 OMP process smoke；Claude fake/injected 证据继续与真实 interactive launch 分层。

- [ ] **Step 1: 写 CLI 红测试**

在临时 DB 中固定：help 不创建 DB；空 `list` 是诚实空状态；无效 `show/compare` 输出人话且不输出内部 reason；拒绝 `use` 不 spawn；`switch` 产生新 plan 并要求重启；supply 失败 stdout 为空且 stderr 有恢复动作；`--client codex-cli` 先返回 unsupported，不创建 plan、不显示确认。Run: `bun test packages/control-plane/tests/integration/cli-human-usable.test.ts`。Expected: 新增契约在当前缺少覆盖时失败；每个失败必须对应待实现行为而非 fixture 错误。

- [ ] **Step 2: 实现最小测试夹具与 CLI 断言**

复用现有 integration 测试的临时目录、真实 SQLite 和 `CliOverrides`，不修改状态机或 adapter 端口；只补齐上述 observable contract 的断言。Run 同一命令，Expected: PASS。

- [ ] **Step 3: 写并运行真实 OMP 红测试**

新增真实 CLI smoke：当 `Bun.which('omp')` 非空时，在临时 DB 建立最小无能力 revision，执行 `configs use <revisionId> --client omp --yes -- --help`，断言 exit 0、确认摘要、handoff 和真实 OMP help；断言默认 home DB 未改变且 invocation 无长期残留。没有 OMP 时使用带原因的 skip。先运行：`bun test packages/control-plane/tests/omp/real-omp-smoke.test.ts`，确认新增 CLI smoke 在实现前按预期失败或缺少入口时失败。

- [ ] **Step 4: 实现并运行绿 smoke**

只复用现有 `buildOmpArgv()`、`BunOmpProcessPort` 和临时 DB/状态路径，不添加模型调用、不改变 `--help` 替代认证模型的边界。Run: `bun test packages/control-plane/tests/integration/cli-human-usable.test.ts packages/control-plane/tests/omp/real-omp-smoke.test.ts`。Expected: CLI 与真实 OMP help spawn PASS；未安装 OMP 只出现有原因的 skip。

- [ ] **Step 5: 保持 Claude 证据诚实**

在 `cli-claude-launch.test.ts` 继续以 fake/injected ports 证明编排、物化和失败状态，断言测试名称/结果不声称真实 interactive launch。若增加真实 Claude acceptance smoke，仅在 `CONTROL_PLANE_REAL_CLAUDE_SMOKE=1` 且 `claude` 可用并能完成隔离 fresh 启动时记录真实结果，否则明确记录 `Unknown/not run`，不计为 pass。不得把 `claude --help` 或 fake port 当作真实客户端验收。

---

### Task 5: 最终验证与范围门（仅验证 Task 1/2/4）

**Files:**
- Inspect only: `packages/control-plane/src/cli/index.ts`
- Inspect only: `packages/control-plane/src/cli/render.ts`
- Inspect only: `packages/control-plane/src/cli/i18n.ts`
- Inspect only: `packages/control-plane/tests/cli/help.test.ts`
- Inspect only: `packages/control-plane/tests/cli/error-rendering.test.ts`
- Inspect only: `packages/control-plane/tests/integration/cli-human-usable.test.ts`
- Inspect only: `packages/control-plane/tests/omp/real-omp-smoke.test.ts`

- [ ] **Step 1: 运行定向验证**

Run: `bun test packages/control-plane/tests/cli/help.test.ts packages/control-plane/tests/cli/error-rendering.test.ts packages/control-plane/tests/integration/cli-human-usable.test.ts packages/control-plane/tests/omp/real-omp-smoke.test.ts`。

Expected: 所有新增行为与真实 OMP smoke 通过；缺少 OMP 时只有明确 skip。

- [ ] **Step 2: 运行 control-plane 包级验证**

Run: `bun run --cwd packages/control-plane typecheck`；`bun test packages/control-plane/tests`。

Expected: 类型检查与 control-plane 全包测试通过；不运行 Harness 测试作为本切片验收。

- [ ] **Step 3: 复核范围**

检查变更不得包含 `packages/harness-engine` 接线、`adapters/clients/codex`、推荐/评分/排序、daemon/服务/遥测、Session locator/lease/fencing、任务语义观察、全局配置清空恢复或 Shell/PowerShell 产品脚本。不得修改 README、`docs/` 或 Harness。

- [ ] **Step 4: 复核 help、错误和 smoke 的最终输出**

Run: `bun run packages/control-plane/src/cli/index.ts --help`、`bun run packages/control-plane/src/cli/index.ts -h`、隔离 DB 下 `list/status`。

Expected: help 含分组和示例；空状态诚实；错误只含人话与恢复动作；真实 OMP 与 Claude 的证据等级不混写。

## Scope Review

覆盖 `configs --help/-h`、分组 usage/示例、公开错误 formatter、内部 reason/Error.message 隔离、CLI 回归测试和真实 OMP smoke。保留现有 OMP/Claude adapter、SQLite schema、一次确认、隔离 invocation、native resume 和 failure state machine。

明确不做 Harness 统一入口、Codex adapter、跨客户端配置等价、推荐/评分/自动选择、daemon、遥测、任务内容观察、Session locator/lease/fencing、全局配置覆盖及 README/docs 变更。

## Self-Review Result

文件映射、函数名、测试行为和执行步骤均已明确；每个新增行为都有先红后绿的步骤和可预期失败原因。计划中的接口与现有 `main()`、`renderQueryFailure()`、`QueryOrEstablishError`、`CliOverrides`、`buildOmpArgv()` 一致。内部 reason 隔离以 sentinel 断言验证，真实 OMP smoke 与 Claude fake/interactive 证据严格分层；未加入未定义接口、自动化推荐或范围外能力。
