# Harness Engine 最终统一 Hardening 报告

日期：2026-08-27

## 结论

已完成最终 whole-branch review 中全部 Critical/Important finding 的统一修复，范围仅限 `packages/harness-engine/**` 与本报告。外部输入在核心结果、lease、dispatch、iteration、PR、artifact 与 port 边界均 fail-closed；Phase 3/Phase 4 不再接受弱布尔成功事实。

## Findings 与修复

| Finding | 修复位置 | 结果 |
| --- | --- | --- |
| Core result validator 可被 malformed narrowing 绕过 | `src/core/result.ts` | EvidenceRef、Known、Unknown、Violation、RecoveryAction、GateResult 均有 own-key allowlist、必需字段、非空约束、RFC3339/逐项数组校验；`isKnown`/`isUnknown`/`isGateResult` 复用校验器并 fail-closed。 |
| ArtifactRevision 接受非法数字 | `src/core/ids.ts`、JSON store | schemaVersion/revision 统一要求非负 safe integer；JSON adapter 使用相同 invariant。 |
| JSON store 空 plan、Done+lease、CAS 回退与 Unicode 隐私逃逸 | `src/adapters/json/json-artifact-store.ts` | plan id/title/row 结构校验；Done 禁止 executionLease；write 要求 `next.revision === expectedRevision + 1`；原始 Unicode key 在 normalization 前识别 `task正文`/`prompt正文` 等动态字段；plan 数组拒绝 sparse。 |
| StaleProof 可由任意对象授权 takeover | `src/domain/lease.ts` | StaleProof 改为闭合 DTO，必须有非空 reason、RFC3339 observedAt、合法 EvidenceRef；移除无条件 boolean bypass；claim/release 对 malformed lease state 均阻断。 |
| Dispatch 使用第二套 HostCapability grammar | `src/gates/dispatch.ts`、`src/ports/host.ts` | dispatch 直接消费 canonical CapabilityResult；仅 supported 且 hostId/hostVersion/evidence 绑定且证据非空时通过；branch/host/lease malformed 输入返回结构化 gate 结果，不抛 TypeError。 |
| Iteration/PR gate 可由布尔或 malformed facts 产生成功 | `src/gates/iteration.ts`、`src/gates/pr-review.ts` | root、数组、数组元素与 sparse 输入运行时校验；Phase 3 要求全部 plan rows 明确为 Done；Phase 4 要求 current-head-bound、带 evidence/residual closure/tally/score/approve verdict 的 MergeReady GateResult，拒绝 bare boolean/stale result。 |
| Review package 动态字段穿透 | `src/domain/review.ts` | 严格六字段 allowlist，`createReviewPackage` 显式重建六字段；ResidualClosure 同样闭合并校验证据。 |
| Generic PortResult 未校验 payload | `src/ports/coordination.ts` | known payload 必须传入 concrete validator callback，且核心 Known validator 拒绝 null/undefined；unknown 复用 Unknown validator；动态字段不能通过泛型包装。 |
| CLI nullish defaults 掩盖 malformed external facts | `src/cli/index.ts` | 仅属性缺失时使用本地默认；显式 null/invalid branch、host、lease 原样交给 gate fail-closed；status 继续读取用户指定 exact file。 |
| 根导出 adapter implementation | `src/index.ts` | 移除 `JsonArtifactStore` 根导出，仅保留 ArtifactStore port；CLI 从 adapter 内部路径导入。 |

## 验证

- `bun test packages/harness-engine/tests`
  - 126 pass，0 fail，317 assertions。
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - 通过，0 diagnostics。
- 额外 smoke：malformed dispatch `null` 返回 `fail` 结构化结果；malformed Known/Unknown guards 返回 false；canonical supported host dispatch 结果可通过 `validateGateResult`；Phase 4 缺少结构化 PR result 返回 `unknown`。

## Residual concerns / 明确边界

- 本次仍不引入真实 Orca/GitHub/host adapter；没有取得的真实后端证据继续由上层以 Unknown/not available 表示。
- JSON store 仍只支持 schema version 1，未来 schema 继续拒绝而不隐式迁移。
- 原有 worktree/control-plane/BMAD 未纳入本波次；工作区中它们的既有修改保持不动。

## 最终复审追加修复

- `src/index.ts` 恢复稳定 public exports：ArtifactRevision/StableIdentity、ArtifactStore、ResumedLease、parseAssignmentExecutionMode、PushCadenceInput/PushDecision 等；继续隐藏 JsonArtifactStore adapter implementation。
- `src/gates/pr-review.ts` 的 `validateMergeReady` 现在重算并核对 tally arithmetic、approved/total、changes/pending/unresolved、score rounding 与 approve verdict，防止 score=0 或伪造 tally 进入 Done。
- `src/adapters/json/json-artifact-store.ts` 先执行 NFKC、Unicode format/spacing normalization，再识别 task/prompt 正文别名；覆盖全角与不可见格式字符测试。
- `src/domain/lease.ts` 与 `src/ports/host.ts` 对 mandatory fields 使用 `Object.hasOwn`，并拒绝继承属性伪造的 lease、StaleProof、CapabilityResult；新增继承属性负例。

追加验证：`bun test packages/harness-engine/tests` 为 129 pass、0 fail、322 assertions；`bunx tsc --noEmit -p packages/harness-engine/tsconfig.json` 通过。
