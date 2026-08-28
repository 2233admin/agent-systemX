import type {
  CommandEvidence,
  CommandsEvidence,
  FailureLedger,
  FailureLedgerRow,
  OwnershipRecord,
  RerunResult,
} from '../../src/validation/failure-ledger.ts';

export const validRerunResult: RerunResult = {
  suiteCommand: 'bun test packages/harness-engine/tests',
  exitCode: 1,
  firstError: 'expected failure',
  observedAt: '2026-08-28T00:00:00.000Z',
};

export const currentFailureWithRerun: FailureLedgerRow = {
  id: 'failure-1',
  suiteCommand: 'bun test packages/harness-engine/tests',
  suiteExitCode: 1,
  firstError: 'expected failure',
  contractRef: 'validation-contract.md#failure-ledger',
  owner: 'harness-engine-stage0',
  rerunCommand: 'bun test packages/harness-engine/tests/domain/workflow.test.ts',
  rerunResult: validRerunResult,
  closureEvidence: [],
};

export const currentFailureWithClosure: FailureLedgerRow = {
  ...currentFailureWithRerun,
  id: 'failure-2',
  rerunResult: null,
  closureEvidence: ['artifact://failure-2-closure'],
};

export const zeroFailureLedger: FailureLedger = {
  status: 'zero-failures',
  failures: [],
  currentHead: '4be39b97c35d4306e773fdc59482db6ebf09cf24',
  commandsEvidence: {
    currentHead: '4be39b97c35d4306e773fdc59482db6ebf09cf24',
    branch: '2233admin/the-request-appears-to',
    worktree: 'D:\\projects\\agent-systemX\\.orca\\worktrees\\hammerhead',
    commands: [{
      name: 'harness-typecheck',
      command: 'bunx tsc --noEmit -p packages/harness-engine/tsconfig.json',
      exitCode: 0,
      output: '',
      observedAt: '2026-08-28T00:00:00.000Z',
    }],
  },
};

export const validOwnershipRecord: OwnershipRecord = {
  currentHead: '4be39b97c35d4306e773fdc59482db6ebf09cf24',
  branch: '2233admin/the-request-appears-to',
  worktree: 'D:\\projects\\agent-systemX\\.orca\\worktrees\\hammerhead',
  ownedPaths: ['packages/harness-engine/src/validation/failure-ledger.ts'],
  attributedDirtyPaths: [],
  untrackedPaths: ['packages/harness-engine/tests/fixtures/validation.ts'],
  conflictingPaths: ['_bmad-output/planning-artifacts/epics.md'],
  implementer: 'current principal-directed execution',
  observedAt: '2026-08-28T00:00:00.000Z',
};

const validCommand: CommandEvidence = {
  name: 'harness-typecheck',
  command: 'bunx tsc --noEmit -p packages/harness-engine/tsconfig.json',
  exitCode: 0,
  output: '',
  observedAt: '2026-08-28T00:00:00.000Z',
};

export const validCommandsEvidence: CommandsEvidence = {
  currentHead: validOwnershipRecord.currentHead,
  branch: validOwnershipRecord.branch,
  worktree: validOwnershipRecord.worktree,
  commands: [validCommand],
};
