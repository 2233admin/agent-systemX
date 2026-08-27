import { isRfc3339Timestamp } from '../core/result.ts';

export interface DeliveryRef {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

export type IssueRef = DeliveryRef;
export type PullRequestRef = DeliveryRef;

export interface DeliveryIssueDto extends DeliveryRef {
  readonly state: string;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

export interface DeliveryPullRequestDto extends DeliveryRef {
  readonly state: string;
  readonly headSha: string;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

export interface DeliveryChecksDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly conclusion: string;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

export interface DeliveryReviewsDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly approved: boolean;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

export interface DeliveryAfterMergeDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly merged: boolean;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
}

/** 交付端口接收明确的仓库/编号和 HEAD，避免把动态后端载荷带入工作流。 */
export interface DeliveryAdapter {
  getIssue(ref: IssueRef): Promise<DeliveryIssueDto | null>;
  getPullRequest(ref: PullRequestRef): Promise<DeliveryPullRequestDto | null>;
  getChecks(ref: PullRequestRef, expectedHead: string): Promise<DeliveryChecksDto | null>;
  getReviews(ref: PullRequestRef, expectedHead: string): Promise<DeliveryReviewsDto | null>;
  readAfterMerge(ref: PullRequestRef, expectedHead: string): Promise<DeliveryAfterMergeDto | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateDto(value: unknown, requiredStrings: readonly string[], allowed: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  if (!Object.hasOwn(value, 'owner') || !Object.hasOwn(value, 'repository') || !Object.hasOwn(value, 'number')) return false;
  if (!nonEmpty(value.owner) || !nonEmpty(value.repository) || typeof value.number !== 'number'
    || !Number.isInteger(value.number) || value.number < 1) {
    return false;
  }
  if (!nonEmpty(value.source) || !nonEmpty(value.version) || !isRfc3339Timestamp(value.observedAt)) return false;
  return requiredStrings.every((key) => Object.hasOwn(value, key) && nonEmpty(value[key]));
}

export function validateDeliveryIssue(value: unknown): value is DeliveryIssueDto {
  return validateDto(value, ['state'], [
    'owner', 'repository', 'number', 'state', 'source', 'version', 'observedAt',
  ]);
}

export function validateDeliveryPullRequest(value: unknown): value is DeliveryPullRequestDto {
  return validateDto(value, ['state', 'headSha'], [
    'owner', 'repository', 'number', 'state', 'headSha', 'source', 'version', 'observedAt',
  ]);
}

export function validateDeliveryChecks(value: unknown): value is DeliveryChecksDto {
  return validateDto(value, ['expectedHead', 'conclusion'], [
    'owner', 'repository', 'number', 'expectedHead', 'conclusion', 'source', 'version', 'observedAt',
  ]);
}

export function validateDeliveryReviews(value: unknown): value is DeliveryReviewsDto {
  if (!validateDto(value, ['expectedHead'], [
    'owner', 'repository', 'number', 'expectedHead', 'approved', 'source', 'version', 'observedAt',
  ])) return false;
  return isRecord(value) && typeof value.approved === 'boolean';
}

export function validateDeliveryAfterMerge(value: unknown): value is DeliveryAfterMergeDto {
  if (!validateDto(value, ['expectedHead'], [
    'owner', 'repository', 'number', 'expectedHead', 'merged', 'source', 'version', 'observedAt',
  ])) return false;
  return isRecord(value) && typeof value.merged === 'boolean';
}
