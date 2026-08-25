---
title: 'Story 3.6：本仓装配意图从既有权威推导，并建立一致性门'
type: 'feature'
created: '2026-08-25'
status: 'done'
baseline_commit: '44e883015d24a2f7f8827201c175d5461222e052'
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-22 退役第 (1) 步要求「本仓自身的装配意图能被表达为一条真实修订，且必须包含 `entrypoints/agent-system.md` 强制加载的两个 Skill」。能力已具备（Story 3.5 实测：51 个 skill 全部物化、零失败），但**这件事在仓库里没有载体**——修订活在本机 SQLite，换台机器就没了，也没有任何东西记录「应该是哪些组」。同时 AD-22 验证边界里那道「规则与能力必须同真」的门至今标着「待建」，入口三处「加载可用的 X」因此仍是空操作。

**Approach:** **不新增装配声明文件。** 意图从仓内两处已有、且各因别的理由存在的权威推导：`entrypoints/agent-system.md` 中「加载可用的 X」点名的 Skill，与 `_bmad/_config/` 的安装器清单。新增一个 repo 级检查，把推导出的组喂给**真实的 `configs supply`** 验证可解析，并验证每个被点名的 Skill 确实落在其中。

## Boundaries & Constraints

**Always:**
- **不新增任何装配声明文件。** 多一份列表就会与入口规则漂移，而漂移正是 `plugins/skill-imports.toml` 失效的死因。意图＝既有权威的推导结果。
- **门必须调用真实的 `configs supply`**（子进程），不得在检查侧另写一遍 `<根>/<组>/skills/<skill>/` 目录约定——把「组是什么」实现两遍正是 AD-22 反复警告的分叉源。
- **提取数为 0 即失败。** 从散文里正则提取 Skill 名是脆的：措辞一改就落空，而落空的失败模式是「静默推导出空集、门照样绿」。必须有反向断言。
- 检查只读：不写 SQLite、不 establish、不改仓内任何文件。
- 检查须能在本机与 CI 两处运行，且 CI 上真实执行（不是只注册不跑）。

**Ask First:** 若发现推导无法覆盖某个本仓会话实际必需的组；若必须修改 `entrypoints/agent-system.md` 的措辞才能让提取稳定。

**Never:** 不改 `entrypoints/agent-system.md` 的规则内容（措辞若确需调整，先 Ask First）。不新增 `configs` 子命令。不恢复 `_bmad/` canonical、不动两份投影的跟踪状态（AD-22 第 (2)(3) 步）。不把推导结果 establish 进任何数据库。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 现状（全一致） | 当前仓库 | 退出 0，报告推导出的组与其 skill 数 | N/A |
| 点名的 Skill 供给不到 | 入口写了一个 `plugins/` 下不存在的名字 | 退出非 0，指名是哪个 Skill、期望在哪个组 | 明确失败 |
| 措辞漂移致提取落空 | 「加载可用的」被改写成别的说法 | **退出非 0**，报告「提取数为 0」 | 反向断言，防静默绿 |
| 组解析失败 | 推导出的组目录被删或缺 `skills/` | 退出非 0，透传 `supply` 的类型化原因 | 复用 `supply` 的 fail-closed |
| bmad 清单缺失 | `_bmad/_config/skill-manifest.csv` 不存在 | 退出非 0，指出该来源缺失 | 明确失败 |
| `configs supply` 不可用 | Bun 缺失或 CLI 报错 | 退出非 0，透传其 stderr，不伪装成「一致」 | 不吞错 |

</frozen-after-approval>

## Code Map

- `tools/assembly_intent/` -- **新建**。与 `tools/skill_registry/`、`tools/dispatch_deadlines/` 同级同形（repo 级检查的既有落点）。推导两处来源 → 调用 `configs supply` 子进程 → 断言。语言按 `entrypoints/agent-system.md` 的「持久实现语言」允许 Python。
- `entrypoints/agent-system.md` 第 62／78／84 行 -- 提取源，模式为「加载可用的」后跟反引号包裹的 Skill 名；实测命中 3 处、2 个不重复名（`orchestrated-collaboration`、`adaptive-problem-solving`），均可解析到 `plugins/<名>`。
- `_bmad/_config/skill-manifest.csv` -- bmad 组的意图来源，49 条；`manifest.yaml` 的 `installation.version` 是其 pin。实测 `--group .agents` 可扫到全部 49 个（`.agents/skills/<skill>/` 恰好匹配目录约定）。
- `packages/control-plane/src/cli/index.ts` -- `supply` 的调用面：`--config-name`、可重复的 `--group`；失败走 stderr、成功走 stdout（Story 3.5 已确立）。
- `packages/control-plane/src/adapters/sources/supply-fs.ts` 的 `normalizeSupplyRef` -- 组名合法性的唯一判定，检查侧不得复制。
- `.github/workflows/repository-checks.yml` -- repo 级检查的既有 workflow；本检查须加进去，并为其补 `oven-sh/setup-bun@v2`（该 workflow 目前只装 Python，而本检查要调 Bun CLI）。**注意其 `paths-ignore` 含 `packages/**`**，而本检查依赖 `packages/control-plane` 的 CLI——须确认触发条件覆盖到位。
- `tools/dispatch_deadlines/tests/` -- repo 级工具的 unittest 组织先例（`python -m unittest discover -s tools/<名>/tests`）。

## Tasks & Acceptance

**Execution:**
- [x] `tools/assembly_intent/` -- 新建推导与检查：两处来源 → 组集合 → 调 `configs supply` 验证 → 断言点名 Skill 落在其中
- [x] 同上 -- 提取数为 0 的反向断言
- [x] `tools/assembly_intent/tests/` -- 覆盖 I/O 矩阵六行，用夹具目录而非真实仓
- [x] `.github/workflows/repository-checks.yml` -- 接入检查 + 补 Bun + 核对触发路径
- [x] `ARCHITECTURE-SPINE.md` -- 把该门从「待建」改为已建，并写明它由推导而非声明驱动

**Acceptance Criteria:**
- Given 当前仓库，when 运行该检查，then 退出 0 并报告推导出的三个组与 51 个 skill。
- Given 把入口某处点名的 Skill 改成一个 `plugins/` 下不存在的名字，when 运行检查，then 退出非 0 并指名该 Skill。
- Given 把入口的「加载可用的」措辞整体改写致提取落空，when 运行检查，then 退出非 0 并报告提取数为 0——不得因为「没发现不一致」而通过。

## Design Notes

**为什么不是「声明文件 + 检查」。** 那是把问题往后挪一层：列表仍需人维护、仍会与入口规则漂移，而检查只能验证列表内部自洽，验证不了列表是否还等于规则的真实要求。推导让「改规则」与「改意图」成为同一个动作，漂移在构造上不可能。

**代价，如实记：** 从散文里正则提取是脆的。缓解是矩阵第三行那条反向断言——落空必须响，而不是静默绿。这不消除脆性，只保证脆性可见。

## Verification

**Commands:**
- `python -m unittest discover -s tools/assembly_intent/tests -v` -- expected: 全绿
- 检查入口本身 -- expected: 退出 0，报告三个组 / 51 个 skill
