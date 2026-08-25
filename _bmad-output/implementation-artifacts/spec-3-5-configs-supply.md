---
title: 'Story 3.5：从 Skill 供给库产出配置修订候选（configs supply）'
type: 'feature'
created: '2026-08-25'
status: 'done'
baseline_commit: '2f2526f1a74162ab08fcd823e280d730c70dc8b8'
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `configs` 至今没有供给路径——`cli/index.ts` 的文档串明写「不存在 `configs sync`／`configs import`」，装配一批 Skill 只能手写候选 JSON 逐条填 `sourceRef`。这是 `#1` 记录的缺口，也是 AD-22 退役第 (1) 步剩下的能力部分（`sourceRef` 语义那半已由 Story 3.4 关闭）。

**Approach:** 新增非交互子命令 `configs supply`：按目录约定扫描供给库，把显式声明的**组**白名单变成候选 JSON 打到 stdout，由既有 `configs establish` 消费。不新造写端口，不新增 schema 列。

## Boundaries & Constraints

**Always:**
- **供给库组织即目录约定：** `<supplyRoot>/<组>/skills/<skill>/`，每个 skill 目录须含 `SKILL.md`。组是装配与判定的单元（AD-22），目录结构**就是**组定义，无第二处可漂移。`plugins/` 今天已是此形状。
- **根只经 `defaultSupplyRoot()` 取得，不接受 `--library` 之类单侧覆盖**——单侧覆盖正是 AD-22 判为 critical 的「各自发明」。一次调用只快照一次根。
- **产出即自检：** 每条 `sourceRef` 必须经 `validateSupplyRelativeRef` 通过，并**采用它返回的规范化 `ref`**（不是自己拼的字符串），保证同一引用只有一种编码。产出侧不得吐出一个稍后必被读侧拒绝的形态。
- **白名单语义**（负责人 2026-08-25 确认）：只产出显式声明的组，未声明的不存在。
- **fail-closed（AD-10）：** 任一被声明的组解析不出内容即整体失败、零输出、非零退出，不产出部分候选。
- `contentFingerprint` 取该 skill 目录内全部文件的 sha256（相对路径排序后逐个喂入路径与内容），用既有 `node:crypto` 的 `createHash` 先例。它是 AD-22 要求 `fork` 组零改动可机械验证、以及退役第 (2) 步 parity 取证的依据，不是装饰。
- 候选只含类型化引用与指纹，不把 Skill 正文读进 JSON（AD-6）。
- 确定性输出：同一库同一组集合两次运行**逐字节相同**（条目按 `<组>/<skill>` 排序）。

**Ask First:** 若必须改 `parseCandidateRevision`、写端口或 schema 才能落地；若目录约定无法表达 `plugins/` 现有布局。

**Never:** 不接 `validateSupplyRelativeRef` 到写边界（已拆为独立后续项，见 `deferred-work.md`）。不 import `tools/skill_registry/` 任何内容（已核实：非 workspace 成员、`noUncheckedIndexedAccess` 下编译失败、模块级 argv 副作用会往 stdout 打整份 registry）。不建第二份组定义文件。不写 SQLite。不恢复 `_bmad/` canonical，不动两份投影的跟踪状态。不做候选生成与推荐（CAP-1／AD-16 仍 Deferred）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 单组 | 库内 `grilling/skills/grilling/SKILL.md` | 候选 JSON 到 stdout，一条 skill，`sourceRef` 为规范化的 `grilling/skills/grilling`，带 sha256 指纹，退出 0 | N/A |
| 多组 | `--group a --group b` | 两组条目合并，按 `<组>/<skill>` 排序 | N/A |
| 确定性 | 同一输入连跑两次 | stdout 逐字节相同 | N/A |
| 可被 establish 消费 | `supply … \| establish …` | 修订落库，`configs show` 显示各条来源引用与指纹 | 沿用 establish 既有失败路径 |
| 组不存在 | `--group nope` | 零输出，退出 1 | `SupplyGroupNotFoundError` |
| 组内无 skill | 组目录存在但无含 `SKILL.md` 的子目录 | 零输出，退出 1（声明了却拿不到＝错误，非空集） | `SupplyGroupEmptyError` |
| skill 目录缺 `SKILL.md` | `<组>/skills/x/` 下无 `SKILL.md` | 该目录不计入；若因此使该组为空则按上一行处理 | 同上 |
| 库根不存在 | `defaultSupplyRoot()` 指向不存在目录 | 零输出，退出 1，原因含该根 | `SupplyRootNotFoundError` |
| 产出自检失败 | 某 skill 名使规范化 ref 不合法 | 零输出，退出 1，原因含该值与根 | 复用 `describeSupplyRefRejection` |
| 缺 `--group` | 只给 `--config-name` | 用法错误 + usage 行，退出 2 | usage-error |
| 缺 `--config-name` | 只给 `--group` | 同上 | usage-error |
| 重复同名 `--group` | `--group a --group a` | 用法错误，退出 2 | usage-error |

</frozen-after-approval>

## Code Map

- `src/adapters/sources/supply-fs.ts` -- **新建**。`loadSupplyGroups(root, groupNames)`：按约定扫描并产出 `CapabilityReference[]`（`kind:'skill'`、`name`=skill 目录名、`sourceRef`=`validateSupplyRelativeRef` 返回的规范化 `ref`、`contentFingerprint`=目录 sha256、`sourceCategory`／`summary` 按既有惯例）。形制先例 `cap-fs.ts:191-260`（泛化 loader、根作参数、无硬编码仓库路径）；`cap-fs.ts` 的 `capSupplyRef` 是产出侧自检的既有写法，照抄其「先校验后用」的次序。
- `src/cli/supply-root.ts:91` -- `validateSupplyRelativeRef` 直接复用，**不得另写判定**；`:129` `describeSupplyRefRejection` 用于失败文案。
- `src/adapters/self-update/checksum.ts` 与 `github-release-updater.ts:65` -- `createHash('sha256')` 的既有用法先例。
- `src/cli/index.ts` -- 头部文档串 `:2-13`（明写「不存在其他子命令」「不存在 configs sync/import」，两处都须改）；`USAGE_SYNTAX` `:119`；`ParsedCommand` `:138`；`parseSupply` 照抄 `parseEstablish` `:242-306` 的 flag 惯例并复用 `parseError.establishFlagRepeated`／`establishFlagRequiresValue`（勿另建 key）；`parseCommand` switch 的 `case 'establish':` 在 `:426`；`runEstablish` `:769` 是 run 函数的形制先例；`main()` 早分派须在 `openDeps()` 之前返回，失败不建库文件；usage-error 走 `:989` 的 exit 2。
- `src/application/ports.ts:59-163` -- 既有错误类的 `kind` 判别式惯例；四个新错误按此新增，并经 `src/application/establish.ts:40-49` 再导出。
- `src/cli/render.ts:162-171` -- 新错误入 `QueryOrEstablishError` 联合；`:186-214` `formatErrorReason` 各加 `case`（`assertNeverErrorKind` `:182` 让漏写编译失败）。
- `src/cli/i18n.ts` -- `zh:27-155`／`en:157-276` 同位置补 key；`zh` 是 key 类型来源，`tests/cli/i18n.test.ts:151` 强制两侧一致。
- `src/adapters/sources/cap-fs.ts:1-23` -- 文档串称「establish／revise 是受支持的非交互供给路径」，本 Story 改变该表述。
- `tests/integration/cli-supply.test.ts` -- **新建**，夹具照 `cli-establish.test.ts:15-33`（tmpDir、`CONTROL_PLANE_DB_PATH` + `CONFIGS_LANG=en`、捕获 `console.log`、`existsSync(dbPath)` 证明零写入）；另需 `CONTROL_PLANE_SUPPLY_ROOT`，env 夹具用**保存并恢复**（同 `tests/cli/supply-root.test.ts`）。

## Tasks & Acceptance

**Execution:**（路径与锚点见 Code Map，不在此重复）
- [x] `supply-fs.ts` -- 新建扫描器 + 目录 sha256 + 逐条经 `validateSupplyRelativeRef` 自检
- [x] `ports.ts` + `establish.ts` -- 四个类型化错误与再导出
- [x] `render.ts` -- 入联合 + `formatErrorReason` 四个 case
- [x] `index.ts` -- `parseSupply` + 分派 + `runSupply`（候选 JSON 到 stdout）+ 两处文档串与 USAGE
- [x] `cap-fs.ts` -- 更新过时的「唯一供给路径」表述
- [x] `i18n.ts` -- zh／en 同位置补 key
- [x] `tests/integration/cli-supply.test.ts` -- 覆盖 I/O 矩阵全部十二行

**Acceptance Criteria:**
- Given 库内两个合规组，when 运行 `configs supply --config-name general --group a --group b`，then stdout 是可被 `configs establish --from -` 直接消费的合法候选 JSON，两次运行逐字节相同。
- Given 一条经 `supply | establish` 落库的修订，when 走 Claude 侧物化，then 每条 skill 的 `sourceRef` 都被解析到真实目录并物化成功，无 `unsupported`／`degraded`——证明供给侧与解析侧确实共用同一套判定。
- Given 同一个组在两个不同的库根下内容不同，when 分别 supply，then 两次产出的 `sourceRef` 相同而 `contentFingerprint` 不同——证明指纹绑的是内容而非路径。

## Spec Change Log

- **2026-08-25（loop 1，patch 集）** — 三层审查在实现后复跑，判定无 intent_gap／无 bad_spec，13 条 patch 直接应用于代码。其中一条为确认的正确性缺陷：两个组含同名 skill 时，物化侧按 `sanitizePathSegment(reference.name)` 推导目标目录，两次 `cp` 落在同一处、后者覆盖前者且 `failures: []` 报告成功——两个审查层各自端到端复现。已在产出侧 fail-closed（`SupplyDuplicateSkillNameError`）；消费侧丢失组身份的根因记入 deferred-work。
  另有三处经变异证明为空的测试：去掉指纹的路径与分隔符投喂、把 `defaultMarker` 改成 `known(true)`、把 `compareCodeUnits` 换成 `localeCompare`——三种改坏之后原 21 条用例全绿。现已分别用「改名不改内容」「三个标量 Fact 逐一断言」「`Z-skill` 与 `a-skill` 并存的排序夹具」钉住，并把确定性断言改为比较 `Bun.spawn` 子进程的真实 stdout 字节。
  **本文件自身的两处错误一并订正：** Boundaries 里「`plugins/` 今天已是此形状」只在根取 `plugins/` 时成立，与 AD-22／`supply-root.ts` 规定的「本仓自我开发时根指向仓库根」矛盾；Verification 命令同样用了 `<repo>/plugins`。实测证明代码比本文件描述得更有能力——**组名可以是多段路径**，根取仓库根时 `--group plugins/grilling` 产出 `sourceRef: plugins/grilling/skills/grilling`，恰好就是 `cap-fs.ts` 的仓库根相对形式，两侧本来就自洽。已按实测改写。
  **避免的已知坏状态：** 一次多组供给静默丢掉其中一个组的同名 skill 并报告装配成功；以及本 Story 的核心产物（指纹）与三个标量事实在无人断言的情况下被改坏。
  **KEEP：** 产出侧复用 `validateSupplyRelativeRef` 而非自写判定；失败一律 stdout 零字节（stdout 是喂给 `establish` 的管道）；跨组去重按规范化 `ref` 而非原始 argv 串。

## Design Notes

**为什么不接受 `--library`：** 供给侧若能单独指定库路径，就能产出一条解析侧按另一个根去找的修订，AD-22 判为 critical 的分歧立刻可复现。共用 `defaultSupplyRoot()` 让一致性由构造保证。

**为什么是目录约定而不是 manifest：** 组的定义已存在于 `tools/skill_registry/matters.json`，但那是资产面且产品够不着（已核实不可 import）。另造 manifest 等于把组模型存两份，必然分叉。让目录结构就是组定义。

**指纹为什么现在算：** AD-22 退役第 (2) 步的 parity 验证要「真实烟雾对照」，需要一个能证明两台机器复现出同一批字节的依据；`sourceRef` 只标识位置不标识内容，指纹是唯一能承担这件事的字段。

## Verification

**Commands:**
- `cd packages/control-plane && bunx tsc --noEmit` -- expected: 零错误
- `cd packages/control-plane && bun test` -- expected: 全绿
- `CONTROL_PLANE_SUPPLY_ROOT=<repo> bun src/cli/index.ts supply --config-name general --group plugins/grilling` -- expected: 输出含 `"sourceRef"` 为 `plugins/grilling/skills/grilling` 的候选 JSON，退出 0
  - `[P10 订正]` 原命令写的是根=`<repo>/plugins`、`--group grilling`，与 `supply-root.ts` 部署场景表「自我开发本仓时根指向**仓库根**」相矛盾。改为根=仓库根后，产出的 `sourceRef` 恰好就是 `cap-fs.ts` 对同一批 Skill 产出的仓库根相对形式，两条产出路径自洽。

## Spec Change Log

- **2026-08-25（loop 1，patch 集）** — 三层审查判定无 intent_gap／无 bad_spec，14 条 patch 已应用。其中三条由 verification-gap 层的真变异证明此前无测试兜住（去掉指纹里的路径与 NUL 投喂、把 `defaultMarker` 改成 `known(true)`、`compareCodeUnits` 换成 `localeCompare`，三种改坏之后均 21 pass 全绿）。最严重一条由两层各自端到端复现：两个组含同名 skill 时物化侧后者覆盖前者、`failures: []` 并报告成功——已在产出侧 fail-closed（`SupplyDuplicateSkillNameError`），消费侧的组身份丢失记入 `deferred-work.md`。**本文件两处错误一并订正：** (a) Boundaries 的括注「`plugins/` 今天已是此形状」只在根取 `plugins/` 时成立，与 AD-22「本仓自我开发时根指向仓库根」矛盾；实测根=仓库根时 `--group plugins/grilling` 正常工作并产出 `plugins/grilling/skills/grilling`，恰是 `cap-fs.ts` 的仓库根相对形式，两者自洽——**组名可以是多段路径**，本文件原先未写。(b) Verification 命令原用 `CONTROL_PLANE_SUPPLY_ROOT=<repo>/plugins`，同样矛盾，已改为根=仓库根。**KEEP：** 去重放在 `supply-fs.ts` 按规范化 ref 做（比 `parseSupply` 层更对，规范化本就发生在那里）；确定性测试另起子进程比真实 stdout Buffer；符号链接两处判断改为一致后硬拒绝而非算出空输入的 sha256。
- **2026-08-25（loop 1 补记，注释语言）** — `context:` 已含 `AGENTS.md` 且 `supply-fs.ts`／`ports.ts` 均按规则写中文，但 `src/cli/index.ts` 新增 124 行注释仅 7 行含中文——因为那些是**扩写既有英文文档串**，实现者保持了段内语言一致。规则的判据是「新增或实质修改」且「碰到哪段就整段改」，已单独 patch 整段转写（现 107 行中 80 行含中文，其余为结构行与 shell 示例）。

## Suggested Review Order

**产出侧的合同（先看这里）**

- 五条判定的复用点：组名与 skill 名都经 `validateSupplyRelativeRef`，并采用它返回的规范化 ref
  [`supply-fs.ts:203`](../../packages/control-plane/src/adapters/sources/supply-fs.ts#L203)

- 按规范化 ref 去重——放在这一层而非 `parseSupply`，因为规范化本就发生在这里
  [`supply-fs.ts:279`](../../packages/control-plane/src/adapters/sources/supply-fs.ts#L279)

- 指纹构成：路径与内容都投喂，覆盖边界在注释里如实写明
  [`supply-fs.ts:182`](../../packages/control-plane/src/adapters/sources/supply-fs.ts#L182)

- 候选装配：三个标量 Fact 的诚实取值（`defaultMarker` 为 `Unknown` 才不是伪造）
  [`supply-fs.ts:438`](../../packages/control-plane/src/adapters/sources/supply-fs.ts#L438)

**fail-closed 的边界**

- 同名 skill 在产出侧硬拒——消费侧布局丢组身份是更深的问题，已记 defer
  [`ports.ts:288`](../../packages/control-plane/src/application/ports.ts#L288)

- I/O 失败不再被吞成「没有这个东西」：只有 ENOENT／ENOTDIR 映射为不存在
  [`ports.ts:315`](../../packages/control-plane/src/application/ports.ts#L315)

**CLI 接线**

- 失败走 stderr 而非 stdout——stdout 是喂给 `establish` 的管道，失败块落在那儿会被当成候选
  [`index.ts:1139`](../../packages/control-plane/src/cli/index.ts#L1139)

- 固定失败标签，不用 `configName`（沿用 `establish`／`revise` 的先例）
  [`index.ts:151`](../../packages/control-plane/src/cli/index.ts#L151)

- flag 解析：组名 trim 且非空判为 usage-error，与 `--config-name` 对齐
  [`index.ts:462`](../../packages/control-plane/src/cli/index.ts#L462)

**测试（外围）**

- 「逐字节相同」另起子进程比真实 stdout Buffer——进程内捕获会被归一化，证明不了这件事
  [`cli-supply.test.ts:188`](../../packages/control-plane/tests/integration/cli-supply.test.ts#L188)

- 顺序无关性按整份候选断言，不只是 `sourceRef` 顺序
  [`cli-supply.test.ts:237`](../../packages/control-plane/tests/integration/cli-supply.test.ts#L237)
