# Agent System 验证报告（2026-08-27）

## 结论先行

本次验证证明了以下范围：

- control-plane 的真实 OMP argv smoke 通过。
- OMP 与 Claude adapter 的目标测试通过；其中 adapter launch 流程使用 fake/injected ports，不能等同于真实 Claude Code 启动。
- 本机可执行 OMP 与 Claude Code 的版本/help 探针均通过。
- `fresh → opaque locator → explicit resume` 未执行，结果记为 **Unknown / not run**。原因同时包括合同范围限制，以及真实 fresh 启动所需的凭据和交互副作用条件不具备。没有把 help 探针或纯单元测试当作该 smoke 的替代证据。

本报告只记录命令和观察结果，不修改产品代码、不提交变更。

## 合同裁决 / 当前版本判定

- 本报告第 10 行及本节保留既有事实：该链此前为 **Unknown / not run**，没有被 help、argv 或 fake/injected 测试替代。
- 按当前版本合同，explicit resume、opaque native Session locator 持久化与 lease-fencing 不属于 MVP 实现；上述链当前判为 **N/A / Deferred**，不进入当前 MVP acceptance pass denominator。它保留为未来目标态/重新激活 gate，只有新证据与负责人明确裁决后才重开。
- 当前 MVP 的 T 样本门仍未完成：T-1/T-2/T-3（无合适 T-3 才 T-4）各需 1 个 baseline + 2 个 stable，且至少一个 stable 来自 fresh/different native Session；因此本报告不得据此追加 `ValidationDecision`。达到样本门后才允许追加 append-only 外部 `ValidationDecision`，该记录不是 MVP 的 SQLite/API/CLI 能力。
- Claude Code 的真实 interactive launch 与任务验收仍为 **Unknown / not run**；其独立 parity gate 不套用 OMP T 门。本报告不将任何范围写成 `Verified`。

## 入口与版本

| 项目 | 观察结果 |
| --- | --- |
| control-plane 测试脚本 | `packages/control-plane/package.json`：`test` 为 `bun test`，`typecheck` 为 `tsc --noEmit` |
| OMP real smoke 入口 | `packages/control-plane/tests/omp/real-omp-smoke.test.ts` |
| Bun | `1.3.14` |
| OMP | `omp/18.0.3` |
| Claude Code | `2.1.241 (Claude Code)` |
| OMP binary | 已发现本机 `omp` 可执行文件；报告不记录更细的本机路径 |
| Claude binary | 已发现本机 `claude` 可执行文件；报告不记录更细的本机路径 |

## OMP 验证

### 真实 native smoke

命令：

```text
bun test tests/omp/real-omp-smoke.test.ts
```

结果：

- 退出码：`0`
- `2 pass`, `0 fail`
- `3 expect()` calls
- 该测试实际发现并启动 native OMP binary。
- 第一个用例将 control-plane 构造的 argv 中消息位置替换为 `--help`，验证 native OMP 接受 `--no-extensions`、`-e <path>` 及 skills 相关参数。
- 第二个用例实际执行 `omp --version`，验证输出符合本包解析的 `omp/<version>` 形式。
- 这是本报告中 OMP 侧唯一实际运行 native binary 的 smoke；它不是 fresh session、locator 获取或 resume smoke。

另外执行的 native CLI surface probe：

```text
omp --version
omp --help
```

观察结果：退出码均为 `0`；help 中存在 `-c, --continue`、`-r, --resume=<value>` 和 `--session-dir`。这只证明 native CLI 暴露了相应入口，不证明一次真实 Session 的恢复链路。

### OMP fake/injected integration tests

命令：

```text
bun test tests/integration/cli-launch.test.ts tests/integration/cli.test.ts tests/integration/db-to-argv.test.ts
```

结果：

- 退出码：`0`
- `48 pass`, `0 fail`
- `185 expect()` calls
- 这些测试通过注入的 OMP ports/fakes 覆盖 control-plane 的 CLI、状态机、argv 和失败路径；它们不是 native OMP client smoke。

## Claude Code adapter 验证

### native CLI probes

命令：

```text
claude --version && claude --help >/dev/null && claude mcp add --help >/dev/null && echo 'claude help probes: exit 0'
```

结果：

- 退出码：`0`
- 版本输出：`2.1.241 (Claude Code)`
- `claude --help` 与 `claude mcp add --help` 均成功返回。
- 这是 native surface/version probe，不是一次真实 Claude interactive launch。

### fresh/parity/materialization 相关测试

命令：

```text
bun test tests/integration/cli-claude-launch.test.ts tests/application/claude-launch.test.ts tests/adapters/claude-content-materializer.test.ts tests/adapters/claude-adapter-plan.test.ts
```

结果：

- 退出码：`0`
- `92 pass`, `0 fail`
- `355 expect()` calls
- 覆盖 Claude fresh launch orchestration、adapter plan、内容物化及 parity 相关合同。
- CLI/application 的 Claude launch 流程使用注入的 fake Claude ports；因此这些通过结果证明 control-plane 行为和物化合同，不证明真实 Claude Code 进程已启动并完成任务。

### Claude process/capability tests

命令：

```text
bun test tests/adapters/claude-process-port.test.ts tests/adapters/claude-capability-probe.test.ts
```

结果：

- 退出码：`0`
- `30 pass`, `0 fail`
- `123 expect()` calls
- 测试包含真实安装存在时的版本/help 探针，也包含 fake-spawn 驱动的错误分支。错误分支是确定性测试，不是 native launch smoke。

## 目标态链事实记录（当前版本不适用）

**事实状态：Unknown / not run；当前版本适用性：N/A / Deferred。**

精确原因如下：

1. `_bmad-output/specs/spec-agent-system/validation-contract.md` 将本次 control-plane 验收定义为 OMP 侧外部验收方法，但当前仓库的 MVP 合同（对应 epics/OMP MVP 边界）明确不实现 explicit resume 启动参数，也不持久化 opaque native Session locator；resume 由 OMP 原生界面负责。control-plane 中没有可诚实调用的“取得 locator 再显式 resume”产品入口。
2. native OMP 的真实 fresh Session 会进入模型/交互流程。此次环境中未配置可用于该调用的 provider credentials；仅记录“所需凭据未具备”，不记录任何凭据值。
3. 即使绕过第 2 项，真实 fresh/resume 还会产生交互式 Session 和客户端状态副作用。当前验证任务要求只读证据收集，不能把一次可能修改用户 Session 状态的交互尝试伪装成无副作用测试。
4. 因此已验证 native OMP 的版本、help 和真实 argv 接受度，但没有声称 locator 获取或 explicit resume 成功，也没有用 fake/injected 测试替代该目标态链的事实记录。

## 未发现的失败

本次实际运行的所有测试命令均为退出码 `0`，没有测试失败可提供文件/测试根因线索。该目标态链的事实状态为 **Unknown / not run**；按当前版本合同不适用（`N/A / Deferred`），不是失败测试。
