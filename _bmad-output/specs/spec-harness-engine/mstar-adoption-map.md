# mstar-harness 可复用资产映射

## 结论

mstar-harness 不应只被当成 `dispatch/status/lease/worktree/sdd/iteration/prreview` 六个模块来吸收。它还有一整套可复用的工程资产：状态模型、路径约定、产物生命周期、角色映射、宿主检测、Plugin 校验、审计、知识结晶、迁移、发布和验证方法。

吸收方式分三类：

1. **移植到 `harness-engine`**：稳定、机械、与 Orca/GitHub 无关的规则；
2. **改造成本仓 adapter/Skill**：依赖宿主、GitHub、Orca 或本仓特有授权的规则；
3. **只作为设计参考**：与本仓权威、运行后端或安全边界冲突的部分。

## 全量映射

| mstar 资产 | 上游职责 | 技术寨处理 | 落点建议 | 首轮 |
| --- | --- | --- | --- | --- |
| `core` | GateResult、ValidationResult、severity、enforcement | 原样吸收语义，减少重复 Result 类型 | `harness-engine/src/core` | P0 |
| `path` | harness/specs/plan/workflow/project 路径解析、scaffold、gitignore | 改为 repo-local 与 control-root 可配置，不硬编码 `.mstar` | `harness-engine/src/path` | P0 |
| `status` | v2 status root、workflow register、plan row、residual 校验 | 吸收 schema 和 fail-loud 原则，适配本仓事实源 | `harness-engine/src/domain/status` | P0 |
| `workflow` | workflow snapshot、生命周期、branch anchors | 吸收，增加 Orca/GitHub 引用 | `harness-engine/src/domain/workflow` | P0 |
| `lease` | execution/integration lease、状态写锁、steal 规则 | 吸收状态机；stale lease 必须适配 Orca 实际证明 | `harness-engine/src/domain/lease` | P0 |
| `dispatch` | Assignment 字段、branch gate、QC seat、anti-recursion | 吸收，接入现有 Orca delegation 语义 | `harness-engine/src/gates/dispatch` | P0 |
| `worktree` | L1/L2 worktree 预检、branch alignment、QC alignment | 吸收，保留本仓 Windows/Orca 边界 | `harness-engine/src/gates/worktree` | P0 |
| `sdd` | task brief、review package、BASE SHA、sticky session 规则 | 吸收，改用本仓可回读 delivery 证据 | `harness-engine/src/gates/sdd` | P0 |
| `iteration` | Phase 1–5、compass、push cadence、close gate | 吸收机械 gate；Phase 1 判断留给 BMad/Agent | `harness-engine/src/gates/iteration` | P1 |
| `project` | roadmap、project register、residual、tech-debt rollup | 吸收 register/rollup；GitHub Project 仍是观察面 | `harness-engine/src/domain/project` | P1 |
| `prreview` | review sizing、tally、score、verdict、report path | 吸收可重算数学；不复制 GitHub 权限和发布语义 | `harness-engine/src/gates/pr-review` | P1 |
| `lint` | plan quality、TDD triple、frontmatter、strategy、temporary marker | 吸收机械检查；与本仓 Skill 合规测试合并 | `harness-engine/src/gates/lint` | P1 |
| `audit` | 代码审计、secret scan、supply-chain、plan scaffold | 吸收只读审计和 secret 不回显边界 | `harness-engine/src/audit` | P1 |
| `compound` | 知识文档 schema、index、scope、overlap、promotion | 与本仓 knowledge-maintenance 合并，不建第二知识库 | `harness-engine/src/gates/knowledge` + existing Skill | P2 |
| `roles` | 角色映射、参数表、load order | 吸收角色契约；和本仓 Plugin 路由做一次映射 | `harness-engine/src/roles` | P1 |
| `host` | 宿主探测、skill root、HostAdapter contract | 吸收 contract；真实宿主逐一 probe | `harness-engine/src/host` | P0 contract / P1 adapters |
| `skill-authoring` | Skill frontmatter、五问题结构、相对资源、ephemeral citation | 与本仓 Skill registry/conformance 合并 | `harness-engine/src/gates/skill-authoring` | P1 |
| `design-md` | DESIGN.md token、light/dark parity、completeness | 只有存在真实 UI/design work 时启用 | `harness-engine/src/gates/design-md` | P2 |
| `migrate` | v1→v2 harness tree 迁移、幂等和失败 | 改造为旧工具/旧 BMad 产物的只读迁移 | `harness-engine/src/migrate` | P1 |
| `agent-plugins` CLI | Plugin validate、manifest、portable package | 与本仓双端 Plugin 校验合并，不复制 package | `harness-engine/src/plugin` 或 existing tools | P1 |
| `init/doctor` | 安装初始化、目标检查、宿主配置诊断 | 做 repo-local doctor；不默认改用户配置 | `harness-engine/src/cli` | P1 |
| `mstar-conventions` | HARNESS_DIR、PLAN_DIR、SPEC_DIR、产物路径 | 改为本仓路径符号与 control worktree 规则 | `harness-engine/src/conventions` | P0 |
| `mstar-artifacts` | plan、snapshot、residual、knowledge、review bundle 生命周期 | 作为本仓产物 SSOT 设计参考 | `harness-engine/src/artifacts` | P0 |
| `mstar-review-qc` | QC tri 编排、residual、四层边界 | 与现有 review/QC 规则合并 | `harness-engine/src/gates/qc` | P0 |
| `mstar-coding-behavior` | RCA、简化、测试、审查、沟通行为 | 不全部代码化；保留为 Skill/角色行为合同 | existing Plugins | P2 |
| `mstar-compound-refresh` | 知识维护、重叠检测、索引更新 | 与 `knowledge-maintenance`、`self-improvement` 统一 | existing Plugins + engine checks | P2 |
| `mstar-strategy` | STRATEGY.md、全局方向 | 保留为 BMad/项目文档，不作为 engine 自动决策 | BMad artifacts | P2 |
| `mstar-skill-authoring` | SkillsBench 门控 | 复用本仓 Plugin conformance，不复制正文 | existing Plugin tests | P1 |
| mstar host references | 各宿主 Plan/Task/Question/Agent 行为 | 转成 capability matrix 和 adapter docs | host adapters | P1/P2 |
| mstar package/release | Bun build、npm pack、standalone smoke、drift lint | 吸收发布验证形状，接入本仓 release workflow | `.github/workflows` + engine release checks | P1 |
| mstar UI panel | dsh/OpenCode 的面板和图形观察面 | 不作为首轮核心；需要时单独做观察层 | future `ops-console` adapter | P2 |

## 需要特别吸收的非代码资产

### 1. 产物生命周期

mstar 最值得吸收的不只是字段，而是这条生命周期：

```text
plan
  → workflow snapshot
  → execution lease
  → review bundle
  → durable summary
  → residual close
  → iteration compound
```

本仓当前已有 BMad、Plugin、Orca 和工具的分散实现，需要统一引用关系，但不必复制 mstar 的目录名字。

### 2. Skill 分层与加载顺序

mstar 的 `core → topic skill → host reference` 加载顺序可复用为本仓 Skill 装配规则：

- 常驻入口只保留最小路由；
- 专题规则按需加载；
- 宿主差异放入 adapter reference；
- engine 只校验机械规则，不把所有判断搬入代码。

这部分应与本仓现有 L1/L2/L3 分层和 `plugins/docs/skills-overview.md` 对齐，不能另建一套体积预算。

### 3. 失败关闭和 Unknown

mstar 的工程门禁应继续使用本仓已经更严格的事实分层：

```text
pass ≠ real backend success
fixture ≠ real host support
process exit 0 ≠ task success
file exists ≠ capability applied
```

所有适配器都必须保留 Unknown、Blocked、Unsupported 的区别。

### 4. 迁移和兼容

不要直接删除现有 `tools/dispatch_*`、`worktree-gc`、BMad 状态文件或 Plugin 流程。先冻结 golden fixtures，再让新 engine 与旧工具并行验证，最后才按逐项证据退役。

## 不直接吸收的内容

| 内容 | 原因 |
| --- | --- |
| mstar 的 `.mstar` 目录作为强制事实源 | 本仓要接入 Orca/GitHub，不能新增第三个实时事实源 |
| mstar 全部宿主一次性激活 | 真实能力、权限、Session 和回执证据不齐 |
| mstar 的默认分支/branch 具体假设 | 本仓必须沿用显式 branch policy 和当前合同 |
| mstar 的 prompt/Skill 原文整体复制 | 已有本仓 Plugin 重叠，容易造成双重路由和双重状态机 |
| dsh/OpenCode panel 作为引擎核心 | 观察层不是工作流事实层，且首轮没有产品需求 |
| 将 GitHub Project 作为授权源 | 本仓已经明确 Project 只是观察面 |
| 自动重派、常驻轮询和 daemon | 与本仓安全边界和当前 Orca 责任划分冲突 |

## 推荐吸收顺序

```text
第一批：core / path / status / workflow / lease / dispatch / worktree / sdd
第二批：orca / github / qc / project / prreview / iteration / host
第三批：lint / audit / roles / skill-authoring / plugin validate / migrate
第四批：compound / design-md / release / UI observation
```

第一批建立事实和安全门；第二批接真实后端和宿主；第三批补质量、审计和维护工具；第四批按真实使用价值再投入。
