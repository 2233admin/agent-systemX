# Control Plane 首次运行

这份指南带你完成一条可复现的首跑路径：安装 Bun，使用隔离的 SQLite 数据库和供给库，产出一条配置修订，然后查看并启动 OMP。

## 1. 安装 Bun 并安装依赖

在仓库根目录执行：

```bash
bun --version
bun install --frozen-lockfile
```

`bun --version` 能打印版本号，且依赖安装完成后没有报错，就可以继续。本文假定后续命令都从仓库根目录执行。

## 2. 查看帮助

```bash
bun run packages/control-plane/src/cli/index.ts --help
bun run packages/control-plane/src/cli/index.ts -h
```

当前版本支持 `--help` 和 `-h` 作为帮助入口；两者都会打印用法：

常用命令是：

- `list`：列出已保存的配置修订版本。
- `show <revisionId>`：查看一条修订包含的能力和状态。
- `use <revisionId> --client omp`：选择修订并启动 OMP。
- `status [planId]`：查看启动计划状态。
- `switch <revisionId> --client omp`：为另一个修订创建需要重启的新启动计划。
- `supply` 和 `establish`：从供给库产出并保存配置修订。

## 3. 设置隔离路径

隔离路径用于避免首跑读写默认用户状态。数据库路径必须指向一个 SQLite 文件；供给根必须指向包含 `<组>/skills/<技能>/SKILL.md` 的目录。

### Git Bash

下面的路径是示例路径，不是固定路径。请把它们换成你自己的临时目录或工作目录：

```bash
export CONTROL_PLANE_DB_PATH="$PWD/.first-run/control-plane.sqlite3"
export CONTROL_PLANE_SUPPLY_ROOT="$PWD"
mkdir -p "$PWD/.first-run"
```

在这个设置下，供给组 `vendor/bmad` 对应的目录是：

```text
$PWD/vendor/bmad/skills/<skill>/SKILL.md
```

### Windows PowerShell

```powershell
$env:CONTROL_PLANE_DB_PATH = "$PWD\.first-run\control-plane.sqlite3"
$env:CONTROL_PLANE_SUPPLY_ROOT = "$PWD"
New-Item -ItemType Directory -Force "$PWD\.first-run" | Out-Null
```

PowerShell 中同样使用供给组 `vendor/bmad`。环境变量只在当前终端窗口有效。

如果没有设置 `CONTROL_PLANE_DB_PATH`，默认数据库路径是：

```text
$HOME/.agent-system-state/control-plane/control-plane.sqlite3
```

如果没有设置 `CONTROL_PLANE_SUPPLY_ROOT`，默认供给根是数据库所在目录下的 `supply/`。首跑建议显式设置两个变量，便于清理和复现。

## 4. 先确认空状态

隔离数据库刚创建时没有配置修订。运行：

```bash
bun run packages/control-plane/src/cli/index.ts list
```

你会看到诚实的空状态：工具只读取 SQLite 中已经保存的修订，不会自行创建、导入或提供配置。看到空状态是正常的，不需要运行不存在的 `init` 命令。

## 5. 从供给库产出候选

本仓库内置的示例供给组是 `vendor/bmad`。运行：

```bash
bun run packages/control-plane/src/cli/index.ts supply --config-name first-run --group vendor/bmad > candidate.json
```

该命令把候选 JSON 写入 `candidate.json`，正常情况下标准输出只包含候选内容。供给库必须满足以下目录约定：

```text
<supplyRoot>/<group>/skills/<skill>/SKILL.md
```

例如本仓库根目录作为供给根时，`vendor/bmad` 组中的文件位于 `vendor/bmad/skills/<skill>/SKILL.md`。

如果提示供给根不存在，请检查 `CONTROL_PLANE_SUPPLY_ROOT`。如果提示组不存在，请确认 `--group` 是相对于供给根的路径，而不是绝对路径。如果某个 skill 目录缺少 `SKILL.md`，请补齐目录内容后重试。

## 6. 保存候选为配置修订

将候选文件交给 `establish`：

```bash
bun run packages/control-plane/src/cli/index.ts establish --trigger-category new-scenario --evidence first-run://recipe --from candidate.json
```

成功时会打印新建修订的详情。记下输出中的 `revisionId`，后面用 `<revisionId>` 代替它。`new-scenario` 是 `establish` 要求的固定触发类别；`first-run://recipe` 只是本例的证据引用，不包含凭据、prompt 或会话内容。

如果候选 JSON 无法读取或字段不合法，命令会失败且不会写入半条修订。先检查 `candidate.json` 是否由上一步生成，并确认供给库中每个 skill 都有 `SKILL.md`。

## 7. 查看修订

再次列出配置：

```bash
bun run packages/control-plane/src/cli/index.ts list
```

查看具体修订：

```bash
bun run packages/control-plane/src/cli/index.ts show <revisionId>
```

详情会列出配置名称、修订标识、状态、边界，以及 Instructions、Skills、MCP 等能力引用。配置修订是不可变的；后续变更应建立新的修订，而不是改写这一条。

## 8. 选择修订并启动 OMP

使用 OMP 客户端启动：

```bash
bun run packages/control-plane/src/cli/index.ts use <revisionId> --client omp
```

命令会先显示启动摘要，并进行一次确认。输入 `y` 或 `yes` 才会继续；其他输入会取消启动。脚本化运行可显式跳过交互确认：

```bash
bun run packages/control-plane/src/cli/index.ts use <revisionId> --client omp --yes
```

确认后，终端控制权交给 OMP，直到 OMP 退出。退出后 `configs` 会打印最终启动状态并退出。进入 OMP 后需要恢复会话时，使用 OMP 自己的原生 resume；Agent System 不拦截、选择或保存 OMP 的会话定位符。

如果要把参数原样传给 OMP，在 `--` 后追加参数，例如：

```bash
bun run packages/control-plane/src/cli/index.ts use <revisionId> --client omp --yes -- --help
```

## 9. 查看状态与切换配置

在 OMP 退出后，或在另一个终端中，查看当前启动计划：

```bash
bun run packages/control-plane/src/cli/index.ts status
```

切换到另一个已保存修订：

```bash
bun run packages/control-plane/src/cli/index.ts switch <anotherRevisionId> --client omp
```

切换不会热修改当前 OMP 进程。它会把旧计划标记为需要重启，为新修订创建新的启动计划，并再次要求该计划唯一的一次确认。确认后按上一节路径启动新的 OMP。

## 客户端边界

- `omp` 是本路径支持的客户端。
- `claude-code` 具备独立 adapter 路径，但其能力和可用性取决于本机实际探测及内容物化结果；失败时按 CLI 给出的阶段、原因和恢复建议处理。
- `codex-cli` 当前不支持。不要把它当成 OMP 的替代客户端，也不要期待配置翻译或跨客户端 resume。

## 常见失败排查

1. **没有找到配置修订**：先运行 `list`；如果是全新隔离数据库，空状态是预期结果。完成 `supply → establish` 后再运行 `show` 或 `use`。
2. **找不到供给根或供给组**：确认两个环境变量仍在当前终端中，确认供给根下存在 `<组>/skills/<技能>/SKILL.md`，并用与根相对的 `--group` 值重试。
3. **候选读取或解析失败**：确认 `candidate.json` 是由 `supply` 产生的完整文件，没有把错误输出混入文件；重新生成后再执行 `establish`。
4. **OMP 启动失败或状态为 `failed`/`incomplete`**：先查看失败块中的阶段和原因，再按 `Recovery`/`恢复建议` 行执行；问题修复后用 `show <revisionId>` 复核修订，再用 `use <revisionId> --client omp` 重试。
5. **想恢复 OMP 会话**：不要给 `configs` 添加不存在的 `resume` 子命令；进入 OMP 后使用 OMP 原生 resume。

完成首跑后，你已经拥有一条可回读的配置修订，并能用 `list`、`show`、`use`、`status` 和 `switch` 管理 OMP 的配置启动流程。
