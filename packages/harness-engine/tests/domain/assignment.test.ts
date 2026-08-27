import { describe, expect, test } from 'bun:test';

import {
  parseAssignmentBranchForms,
  parseAssignmentFields,
} from '../../src/domain/assignment.ts';

describe('Assignment parsing', () => {
  test('parses the three supported branch forms and stops before task body', () => {
    const text = `
## Assignment
Execute as: worker
Delegation: local
Task category: implementation
Working branch: feature/parser
Branch policy: isolated
Direct-on reason: only for protected branches

## Task
Working branch: leaked-from-task
Prompt: do not return this
`;

    expect(parseAssignmentFields(text)).toEqual({
      executeAs: 'worker',
      delegation: 'local',
      taskCategory: 'implementation',
      workingBranch: 'feature/parser',
      branchPolicy: 'isolated',
    });
    expect(parseAssignmentBranchForms(text).forms).toEqual([
      { kind: 'working-branch', value: 'feature/parser', line: 6 },
      { kind: 'branch-policy', value: 'isolated', line: 7 },
      { kind: 'direct-on', value: 'only for protected branches', line: 8 },
    ]);
    expect(parseAssignmentFields(text)).not.toHaveProperty('prompt');
  });

  test('accepts the alternate branch label as one branch form', () => {
    expect(parseAssignmentBranchForms('Branch: release/1\n')).toEqual({
      forms: [{ kind: 'working-branch', value: 'release/1', line: 1 }],
      workingBranch: 'release/1',
    });
  });

  test('does not turn missing or empty required fields into values', () => {
    expect(parseAssignmentFields('Execute as:   \nDelegation:\nTask category:')).toEqual({});
  });

  test('normalizes execution mode while preserving unknown values for the gate', () => {
    expect(parseAssignmentFields('Execution mode: SDD')).toEqual({ executionMode: 'sdd' });
    expect(parseAssignmentFields('Execution mode: custom')).toEqual({ executionMode: undefined });
  });
});
