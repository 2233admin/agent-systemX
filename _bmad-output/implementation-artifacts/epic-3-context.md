# Epic 3 Context: 配置供应与装配

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

本 Epic 让"装配"（把裁决结果写成可持久化的配置修订）成为与"使用"（Epic 1 的看／选／用）并列、但不合并的第二个能力面。写路径半边已交付：3.1／3.2／3.3 落地了建立新修订、追加替代修订、展示装配来源与替代链；3.4 裁定并落地了 `sourceRef` 的跨机器可移植性语义（AD-22 退役第 (1) 步里"必须一并裁定 `sourceRef` 语义"这一开放项已因此关闭）。**Epic 3 剩余范围只有供应半边，即 Story 3.5**：把一批磁盘上按组组织的 Skill 目录变成配置修订候选，交给既有 `establish` 消费。今天这一半仍靠人手写含全部条目的候选 JSON，无法规模化；它同时是本仓 Skill 资产退役 git 跟踪三步顺序中第 (1) 步的其余部分（缺口记于 `#1`）。

## Stories

- Story 3.1：建立新配置修订（configs establish）— done
- Story 3.2：修订现有配置（configs revise）— done
- Story 3.3：查看装配来源与替代链 — done
- Story 3.4：裁定并落地 sourceRef 的跨机器可移植性语义 — done
- Story 3.5：从 Skill 供给库产出配置修订候选（configs supply）— 本轮唯一待做

## Requirements & Constraints

- 供应能力的目标形态：用户**按组声明白名单**即可得到一份候选，而不是逐条抄写来源引用；产出经既有建立路径落成一条 `sourceRef` 真实可解析的修订。本仓自身的装配意图也必须能被表达为一条真实修订——自我开发装配与产品装配是两个消费者、一条路径，不为前者另立机制。
- **组是第一结构**：装卸、版本、发现、判定与复核都以组为单位而非单个 Skill（当前 12 个组／82 个 Skill，判定 12 次）。组内成员互相路由调用，拆组会拆断调用，因此组是不可再分的装配与判定单元；装配意图、来源归属与退役顺序全部按组表达。
- **组的来源三分是判据不是标签**：`own`（自研）／`fork`（取自上游、承诺零本地改动）／`vendor`（取自上游已打补丁，须逐处登记）。`fork` 的零改动必须能用内容指纹对上游 ref 机械验证，指纹不符即须转 `vendor` 或把改动推回上游，不接受仅凭声明。
- **字节所有权按来源判定，不按存放位置**：第三方组的字节是上游可复现产物，仓库跟踪其 **pin**、不跟踪字节。一个 pin 只有同时具备可取得的来源与可校验的完整性才成立，仅记版本号不算。
- 候选内容逐字段按声明类型校验，类型不符整体拒绝、零写入；建立／修订前必须先校验并持久化触发类别与真实工作／证据引用，且校验早于读取候选内容。命令非交互优先，未提供候选来源时立即类型化失败而不阻塞等待。
- 修订不可变：只追加并以 `supersedes` 引用旧修订，写端口 insert-only，不提供 update/delete。
- 持久化受统一隐私边界约束：只存类型化引用、来源标识、可公开摘要、内容指纹与新鲜度证据；私域原文、凭据、任务内容与 transcript 禁止入库，写入 schema 用显式 allowlist 拒绝未知字段。
- 来源不可解析时按 fail-closed 处理（必需记 `unsupported`、可选记 `degraded`），不得静默跳过或用占位内容伪装成功。
- 不得滑向已排除的非目标：不演变为团队治理，也不做"从任意公开仓库拉取他人共享配置"式的公共共享／发现语义。面向外部来源（GitHub 仓库／通用本地目录格式、来源可信边界）的接入协议仍未拍板，不得在实现层面自行发明映射规则。

## Technical Decisions

- **`sourceRef` 只有一种合法形态：库内相对 POSIX 路径。** 绝对路径一律拒绝。五条判定规则（非空 → 不含反斜杠 → 不带盘符前缀 → 非绝对 → 解析后严格落在根内）集中在唯一实现 `validateSupplyRelativeRef`（`packages/control-plane/src/cli/supply-root.ts`），供给侧与解析侧共用，**不存在任一侧的单独覆盖入口**——"禁止两个实现者各自发明"从此由机制保证。供给命令必须复用该实现、并把它接到写边界（写路径目前仍只做 `isString`，可持久化一条永远无法启动的非法 ref），同时强制使用它返回的规范化 ref，避免同一引用出现多种字符串编码。
- **根是本机配置、不进修订**，机器差异只由根承担：根由共用的 `defaultSupplyRoot()` 提供（环境变量 `CONTROL_PLANE_SUPPLY_ROOT` 覆盖，默认由数据库路径目录派生的 `supply/`）。两种部署场景都要认：本仓自我开发时供给库就是本仓库，根经环境变量指向仓库根；发行版用户机器上没有"本仓库"，走默认值。一次调用只快照一次根，不在每个引用处重读。
- **唯一受认可的装配交付路径**是经 `configs use <revisionId> --client <clientId>` 启动、在调用作用域内物化。客户端原生项目目录发现（`.claude/skills/`、`.agents/skills/`）**不是装配面**：不产生 manifest、不绑定 capability 状态、不产生 receipt，因此不能为任何能力声称 observation 阶段。未经 `configs` 启动的会话按定义不具备本产品装配的能力，这是已接受的结果。
- **字节落点不得踩原生发现路径**，否则唯一装配路径退化为无人执行的声明。canonical 落点定为 `_bmad/`（非任何客户端的发现路径，且与安装器自身安装形状一致），安装器须配置为不产生 IDE 投影，`configs` 从 canonical 路径物化。
- **装配权威唯一**：只有 `configs` 的修订是装配权威；`plugins/skill-imports.toml` 自称的"当前默认装配声明"无任何产品代码消费，不是权威，其措辞待退役第 (3) 步统一收敛。
- **规则与能力必须同真**：仓库入口规则不得强制加载一个当前装配下拿不到的 Skill，"加载可用的 X"不构成豁免。已知不一致的 `orchestrated-collaboration` 与 `adaptive-problem-solving` 只存在于 `plugins/`，必须纳入本仓装配意图，否则退役第 (1) 步不算完成。
- **控制面／adapter 职责分离**：应用层是唯一产品状态变更入口，CLI 负责选择与确认，adapter 只做 probe/plan/launch/interpret 且不得直接改写 SQLite。SQLite 是持久权威，JSON/Markdown 只是可重建的 allowlist 投影。
- **事实层级不可折叠**：capability 固定为 `supported | degraded | unsupported | unknown`；不确定值一律用 Known(值, 证据引用)／Unknown(原因, 观察时间)，不得用 null、缺行或 false 冒充未知。
- **可复用的既有先例**：insert-only 写端口；已具备 `trigger_category`／`evidence_ref`（NOT NULL）、`supersedes_revision_id` 与两个唯一索引的 schema；修订类型已含 `sourceRef`／`contentFingerprint`；失败一律抛类型化 Error 由 CLI 捕获后复用既有渲染；用户可见文案需同时补齐中英 i18n key。

## Cross-Story Dependencies

- **3.5 必须排在 3.4 之后（现已满足）。** 顺序颠倒会产出带相对 `sourceRef` 的修订而解析侧仍按绝对路径处理，结果是按 fail-closed 静默全量降级——正是被判为 critical 的失败模式。
- 3.2、3.3 依赖 3.1 建立的 schema 与写端口／渲染约定；3.5 通过既有建立路径消费候选，不新建平行写路径，也不需要新增迁移列。
- Epic 3 是 Epic 1 的数据供应前提：Epic 3 写入修订，Epic 1 保持唯一的查看／选择／启动消费面，两者不合并。
- 与 Epic 4 的接缝在 `sourceRef`：Epic 4 只交付"已解析内容 → 它自己 spawn 的 fresh 会话"这一段，上游"资产目录 → 可移植修订"归本 Epic，两侧共用同一套判定实现。
- **本仓 Skill 资产退役严格三步、不得倒序**：(1) 落地替代——先按 pin 运行安装器恢复本仓残缺的 canonical（清单记录 263 个文件，磁盘上只剩九个配置文件、254 个本体缺失），再让 `configs` 具备供给能力并把本仓装配意图表达为一条真实修订；(2) parity 验证——经 `configs use` 启动的会话，其实际可用 Skill 集合与原生发现所得集合做**真实烟雾对照**（非清单比对），且必须在不存在用户级安装的环境中进行，否则结论假阳性；(3) 退役——原生发现目录改为非跟踪并进入忽略清单，双份字节一致门随之退役。第 (2) 步稳定前两份保持跟踪、一致门继续生效。
- 3.4 遗留、由 3.5 顺带接线或另行判断的项：写边界接入 `validateSupplyRelativeRef`；`configs show` 现在打印裸相对 ref 而无根的上下文，可观察性有回退；根内符号链接／junction 指向根外仍能通过纯词法收敛判定。
- 开放问题（不阻塞、落地时再判）：Codex 侧尚无等价 `configs` 启动入口，其 parity 验证暂时无法执行；是否允许两个客户端按各自节奏分别退役各自投影目录，留待落地时依真实能力判断。
