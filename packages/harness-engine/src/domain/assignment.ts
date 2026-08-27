export interface AssignmentFields {
  readonly executeAs: string;
  readonly delegation: string;
  readonly taskCategory: string;
  readonly workingBranch?: string;
  readonly branchPolicy?: string;
  readonly executionMode?: 'sdd' | 'inline';
}

export type AssignmentBranchFormKind = 'working-branch' | 'branch-policy' | 'direct-on';

export interface AssignmentBranchForm {
  readonly kind: AssignmentBranchFormKind;
  readonly value: string;
  readonly line: number;
}

export interface AssignmentBranchForms {
  readonly forms: readonly AssignmentBranchForm[];
  readonly workingBranch?: string;
  readonly branchPolicy?: string;
  readonly directOnReason?: string;
}

interface HeaderEntry {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

function normalizeKey(value: string): string {
  return value
    .replace(/^\*+|\*+$/g, '')
    .replace(/^`+|`+$/g, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[\s_-]+/g, ' ');
}

function cleanValue(value: string): string {
  return value
    .replace(/\s*\|\s*$/, '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/^`+|`+$/g, '')
    .trim();
}

function isTaskBodyMarker(line: string): boolean {
  const candidate = line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  const key = normalizeKey(candidate.replace(/\s*:.*$/, ''));
  return /^(?:task|task body|task details|prompt|prompt body|body|instructions|dynamic task|task正文|prompt正文)$/.test(key);
}

function readHeaderEntries(text: string): readonly HeaderEntry[] {
  const entries: HeaderEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    if (isTaskBodyMarker(rawLine)) break;

    let line = rawLine.trim();
    line = line.replace(/^[-*+]\s+/, '');
    line = line.replace(/^\|\s*/, '').replace(/\s*\|$/, '');
    line = line.replace(/^\*+|\*+$/g, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;

    const key = normalizeKey(line.slice(0, separator));
    const value = cleanValue(line.slice(separator + 1));
    if (key.length === 0 || value.length === 0) continue;
    entries.push({ key, value, line: index + 1 });
  }
  return entries;
}

function entriesFor(text: string, keys: readonly string[]): readonly HeaderEntry[] {
  const accepted: Record<string, true> = {};
  for (const key of keys) accepted[normalizeKey(key)] = true;
  return readHeaderEntries(text).filter((entry) => accepted[entry.key] === true);
}

/** 只读取 Assignment 头部的白名单字段，遇到任务正文标记立即停止。 */
export function parseAssignmentFields(text: string): Partial<AssignmentFields> {
  const first = (keys: readonly string[]): string | undefined => entriesFor(text, keys)[0]?.value;
  const executeAs = first(['execute as']);
  const delegation = first(['delegation']);
  const taskCategory = first(['task category']);
  const workingBranch = first(['working branch', 'branch', 'worktree branch']);
  const branchPolicy = first(['branch policy']);
  const executionMode = first(['execution mode'])?.toLocaleLowerCase();

  return {
    ...(executeAs === undefined ? {} : { executeAs }),
    ...(delegation === undefined ? {} : { delegation }),
    ...(taskCategory === undefined ? {} : { taskCategory }),
    ...(workingBranch === undefined ? {} : { workingBranch }),
    ...(branchPolicy === undefined ? {} : { branchPolicy }),
    ...(executionMode === 'sdd' || executionMode === 'inline' ? { executionMode } : {}),
  };
}

/** 返回头部中所有互斥分支声明；direct-on 仅是受保护分支的例外理由。 */
export function parseAssignmentBranchForms(text: string): AssignmentBranchForms {
  const branchEntries = entriesFor(text, ['working branch', 'branch', 'worktree branch']);
  const policyEntries = entriesFor(text, ['branch policy']);
  const directEntries = entriesFor(text, [
    'direct on',
    'direct-on',
    'direct on reason',
    'direct-on reason',
    'direct write reason',
  ]);
  const forms: AssignmentBranchForm[] = [
    ...branchEntries.map((entry) => ({ kind: 'working-branch' as const, value: entry.value, line: entry.line })),
    ...policyEntries.map((entry) => ({ kind: 'branch-policy' as const, value: entry.value, line: entry.line })),
    ...directEntries.map((entry) => ({ kind: 'direct-on' as const, value: entry.value, line: entry.line })),
  ].sort((left, right) => left.line - right.line);

  return {
    forms,
    ...(branchEntries[0] === undefined ? {} : { workingBranch: branchEntries[0].value }),
    ...(policyEntries[0] === undefined ? {} : { branchPolicy: policyEntries[0].value }),
    ...(directEntries[0] === undefined ? {} : { directOnReason: directEntries[0].value }),
  };
}

/** 供 dispatch gate 检测未知 mode；不返回正文，也不放宽字段联合类型。 */
export function parseAssignmentExecutionMode(text: string): string | undefined {
  return entriesFor(text, ['execution mode'])[0]?.value.toLocaleLowerCase();
}
