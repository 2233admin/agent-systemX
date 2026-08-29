import { isRfc3339Timestamp } from '../core/result.ts';
import { isConcreteRevision } from '../domain/review.ts';
import type { AdapterCorrelationEnvelope } from '../adapters/contracts.ts';
import { validateAdapterCorrelation } from '../adapters/contracts.ts';
import type { PortResult } from './coordination.ts';

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
  readonly correlation?: AdapterCorrelationEnvelope;
}
export interface DeliveryPullRequestDto extends DeliveryRef {
  readonly state: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

export interface DeliveryChecksDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly conclusion: string;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

export interface DeliveryReviewsDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly approved: boolean;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

export interface DeliveryAfterMergeDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly merged: boolean;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

export interface DeliveryMergeReadyDto extends DeliveryRef {
  readonly expectedHead: string;
  readonly mergeReady: boolean;
  readonly source: string;
  readonly version: string;
  readonly observedAt: string;
  readonly correlation?: AdapterCorrelationEnvelope;
}

/** 交付端口接收明确的仓库/编号和 HEAD，避免把动态后端载荷带入工作流。 */
export interface DeliveryAdapter {
  getIssue(ref: IssueRef): Promise<PortResult<DeliveryIssueDto>>;
  getPullRequest(ref: PullRequestRef): Promise<PortResult<DeliveryPullRequestDto>>;
  getChecks(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryChecksDto>>;
  getReviews(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryReviewsDto>>;
  prepareMergeReady(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryMergeReadyDto>>;
  readAfterMerge(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryAfterMergeDto>>;
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
  if (value.correlation !== undefined && !validateAdapterCorrelation(value.correlation)) return false;
  return requiredStrings.every((key) => Object.hasOwn(value, key) && nonEmpty(value[key]));
}

export function validateDeliveryIssue(value: unknown): value is DeliveryIssueDto {
  return validateDto(value, ['state'], [
    'owner', 'repository', 'number', 'state', 'source', 'version', 'observedAt', 'correlation',
  ]);
}

export function validateDeliveryPullRequest(value: unknown): value is DeliveryPullRequestDto {
  if (!validateDto(value, ['state', 'baseSha', 'headSha'], [
    'owner', 'repository', 'number', 'state', 'baseSha', 'headSha', 'source', 'version', 'observedAt', 'correlation',
  ])) return false;
  return isRecord(value) && isConcreteRevision(value.baseSha) && isConcreteRevision(value.headSha);
}

export function validateDeliveryChecks(value: unknown): value is DeliveryChecksDto {
  if (!validateDto(value, ['expectedHead', 'conclusion'], [
    'owner', 'repository', 'number', 'expectedHead', 'conclusion', 'source', 'version', 'observedAt', 'correlation',
  ])) return false;
  return isRecord(value) && isConcreteRevision(value.expectedHead);
}

export function validateDeliveryReviews(value: unknown): value is DeliveryReviewsDto {
  if (!validateDto(value, ['expectedHead'], [
    'owner', 'repository', 'number', 'expectedHead', 'approved', 'source', 'version', 'observedAt', 'correlation',
  ])) return false;
  return isRecord(value) && isConcreteRevision(value.expectedHead) && typeof value.approved === 'boolean';
}

export function validateDeliveryMergeReady(value: unknown): value is DeliveryMergeReadyDto {
  if (!validateDto(value, ['expectedHead'], [
    'owner', 'repository', 'number', 'expectedHead', 'mergeReady', 'source', 'version', 'observedAt', 'correlation',
  ])) return false;
  return isRecord(value) && isConcreteRevision(value.expectedHead) && typeof value.mergeReady === 'boolean';
}

export function validateDeliveryAfterMerge(value: unknown): value is DeliveryAfterMergeDto {
  if (!validateDto(value, ['expectedHead'], [
    'owner', 'repository', 'number', 'expectedHead', 'merged', 'source', 'version', 'observedAt', 'correlation',
  ])) return false;
  return isRecord(value) && isConcreteRevision(value.expectedHead) && typeof value.merged === 'boolean';
}
