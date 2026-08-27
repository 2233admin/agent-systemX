# Task 4 实现报告

## 变更文件

- `packages/harness-engine/src/domain/lease.ts`
  - 新增严格的 `ExecutionLease` 与 `IntegrationMergeLease` 合同。
  - 新增纯函数 `claimLease`、`releaseLease`、`canStealLease`、`validateLease`。
  - 同一 holder 可 resume；其他 holder 默认 blocked；只有显式 `staleProof` 才可接管。
  - fencing token 从 1 开始，并通过当前 lease/release 状态或 `lastFencingToken` 单调递增。
- `packages/harness-engine/src/gates/worktree.ts`
  - 新增 `WorktreeIdentity`、`WorktreeAlignment`、`WorktreeAlignmentInput`。
  - 新增只读 `validateWorktreeAlignment`，校验 workflow/plan、branch、worktree path、owned paths、execution lease holder、integration branch/lease，并对 owned-path overlap 返回 blocked。
  - gate 不执行文件系统、网络、Orca 或 GitHub 操作。
- `packages/harness-engine/src/domain/workflow.ts`
  - 移除旧的宽松 lease 结构，改为复用 `domain/lease.ts` 的精确 lease 类型并保持对外 re-export。
- `packages/harness-engine/src/gates/dispatch.ts`
  - dispatch reader 改为直接消费 canonical execution lease，不再支持 `held/active/taskId` 第二套 schema。
- `packages/harness-engine/src/adapters/json/json-artifact-store.ts`
  - 持久化读取/写入统一调用 domain `validateLease`，拒绝旧/畸形 lease。
- `packages/harness-engine/src/index.ts`
  - 导出 lease transition 合同、纯函数及 worktree alignment 合同/gate。
- `packages/harness-engine/tests/domain/lease.test.ts`
  - 覆盖首 claim、同 holder resume、第二 holder 拒绝、stale proof 接管、fencing token 递增、release token 校验、integration lease 独占、claim/release malformed wrapper 与隐私字段 fail-closed。
- `packages/harness-engine/tests/gates/worktree.test.ts`
  - 覆盖对齐成功、缺 worktree、branch mismatch、owned-path overlap、holder/integration mismatch、plan mismatch 与 Done 携带 execution lease。
- `packages/harness-engine/tests/gates/dispatch.test.ts`
  - 增加 canonical execution lease 到 dispatch 的兼容回归。
- `packages/harness-engine/tests/adapters/json-artifact-store.test.ts`
  - 增加 canonical malformed lease 持久化回归。

## 测试与验证

- `bun test packages/harness-engine/tests/domain/lease.test.ts packages/harness-engine/tests/gates/worktree.test.ts packages/harness-engine/tests/gates/dispatch.test.ts packages/harness-engine/tests/adapters/json/json-artifact-store.test.ts`
  - 通过：47 tests，0 fail，110 assertions。
- `bunx tsc --noEmit -p packages/harness-engine/tsconfig.json`
  - 通过：无诊断输出。
- `bun test packages/harness-engine/tests`
  - 通过：82 tests，0 fail，170 assertions。
- 按 TDD 要求，先运行 focused tests，确认新增 review-fix 负例失败，再实现 canonical lease reader、allowlist 与 persistence validator。

## Public API 摘要

- `ExecutionLease`：`kind/workflowId/planId/holderId/worktreePath/fencingToken/claimedAt`。
- `IntegrationMergeLease`：`kind/workflowId/integrationBranch/holderId/fencingToken/claimedAt`。
- `claimLease(current, claim, staleProof?)`：返回 `claimed | resumed | blocked`。
- `releaseLease(current, holderId, fencingToken)`：返回 `released | blocked`，release 结果保留 fencing counter 供后续 claim 使用。
- `canStealLease(lease, staleProof?)`：仅在 lease 有效且提供显式 stale proof 时返回 true。
- `validateLease(value)`：对 malformed、缺字段、非法 token/timestamp、未知字段及隐私字段返回 false。

## Concerns

- fencing token 的跨进程单调性依赖调用方把当前 lease/release counter 作为输入传回；本任务刻意不引入进程内 mutex、持久化或协调后端。
- worktree gate 的输入分为 `expected` 与 `observed` 两个身份快照；实际 adapter/ArtifactStore 仍需在外层提供这两份只读事实。
- ArtifactStore 现在复用 domain canonical validator；未来扩展 lease 字段时必须同步更新 allowlist、显式构造和持久化 contract tests。
