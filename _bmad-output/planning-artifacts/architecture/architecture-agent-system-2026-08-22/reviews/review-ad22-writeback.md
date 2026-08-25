# Reviewer gate —— AD-22 回写（2026-08-25，Story 3.4 裁定落地）

子 agent 授权仅覆盖本轮 bmad-build 运行，本次小幅 Update 按 gate 既定回退内联执行两条配置 lens。

## current-tech —— PASS，无 findings

回写引用的每条事实均已在本 session 内实测或直接观察，非训练数据断言：

| 断言 | 核实 |
| --- | --- |
| 合并于 `8d56565` | 本 session 执行的合并，回读确认 |
| `validateSupplyRelativeRef` 在 `packages/control-plane/src/cli/supply-root.ts` | 读源码，五条规则逐条对齐 |
| 盘符规则排在 `isAbsolute` 之前 | 读源码确认 |
| `known('')`／`known('.')` 使 `path.resolve` 返回根本身 | win32 实测（根取 `D:\lib`） |
| 同盘 `C:x/y` 被折进根内、`C:/x/y` 在 POSIX 上 `isAbsolute` 为假 | win32 实测 + 审查层独立复现 |
| 真实库 20 个 skill 条目 `sourceRef` 全 `Unknown`、Known 零条 | 只读查询本机 `control-plane.sqlite3` |

## adversarial —— PASS with findings（1 项 high，已当场修复）

**F1 [high] 权威面没说根实际怎么取。** 构造：Story 3.5 的实现者只读 spine（按 AGENTS.md，spine 才是权威），要为本仓自身产出一条修订。AD-22 通篇只出现一次 `defaultSupplyRoot`，`CONTROL_PLANE_SUPPLY_ROOT`／部署场景／仓库根三个词零出现。该实现者只能推断用默认根 `$HOME/.agent-system-state/control-plane/supply`——而 AD-22 自己在上一条 Rule 里刚把 canonical 落点定为 `_bmad/`（仓库相对）。两者拼起来解析不到任何东西，且失败形态是 AD-10 静默降级。两种部署场景此前只写在 spec 与代码注释里，够不着权威面——与本 AD 当初成立的理由（成熟模型挂在工具 README 上、够不着权威面）是同一种病。**处置：** autofix，已在落点那条 Rule 补入两种场景与各自的根来源。

**未发现分歧的构造：** 供给侧与解析侧共用唯一谓词且无单独覆盖入口，两个实现者无从各自发明；退役三步顺序与「第 (2) 步稳定前保持跟踪」的条件未被本次改动触碰。

## 同轮修复的既有缺陷

PR #176 的替换未清锚点，导致「并且必须在这一步一并裁定 `sourceRef` 的跨机器可移植性语义——」连续重复两遍。本轮删除。`lint_spine` 修订前后均 0 findings——该 lint 不检测重复句，靠人读发现。
