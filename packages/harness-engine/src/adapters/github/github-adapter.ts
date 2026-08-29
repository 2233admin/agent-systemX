import type { Unknown } from '../../core/result.ts';
import type { PortResult } from '../../ports/coordination.ts';
import {
  validateDeliveryAfterMerge,
  validateDeliveryChecks,
  validateDeliveryIssue,
  validateDeliveryMergeReady,
  validateDeliveryPullRequest,
  validateDeliveryReviews,
  type DeliveryAdapter,
  type DeliveryAfterMergeDto,
  type DeliveryChecksDto,
  type DeliveryIssueDto,
  type DeliveryMergeReadyDto,
  type DeliveryPullRequestDto,
  type DeliveryRef,
  type DeliveryReviewsDto,
  type IssueRef,
  type PullRequestRef,
} from '../../ports/delivery.ts';
import { validatePortResult } from '../../ports/coordination.ts';
import { reconcileCorrelation, type AdapterCorrelationEnvelope, type ControlledTransport } from '../contracts.ts';

export interface GithubReadbackContext {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly expectedHead: string;
}

type GithubRequest = GithubReadbackContext & {
  readonly kind: 'issue' | 'pull-request' | 'checks' | 'reviews' | 'merge-ready' | 'after-merge';
  readonly correlation: AdapterCorrelationEnvelope;
};

function unknown(reasonCode: string): Unknown {
  return { kind: 'unknown', reasonCode, observedAt: new Date().toISOString(), recovery: 're-read the current GitHub object before retrying' };
}
export class ControlledGithubAdapter implements DeliveryAdapter {
  public constructor(
    private readonly transport: ControlledTransport<GithubRequest, unknown>,
    private readonly correlation: AdapterCorrelationEnvelope,
  ) {}

  public async getIssue(ref: IssueRef): Promise<PortResult<DeliveryIssueDto>> {
    return this.read({ ...ref, expectedHead: '', kind: 'issue', correlation: this.correlation }, validateDeliveryIssue);
  }

  public async getPullRequest(ref: PullRequestRef): Promise<PortResult<DeliveryPullRequestDto>> {
    return this.read({ ...ref, expectedHead: '', kind: 'pull-request', correlation: this.correlation }, validateDeliveryPullRequest);
  }

  public async getChecks(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryChecksDto>> {
    return this.read({ ...ref, expectedHead, kind: 'checks', correlation: this.correlation }, validateDeliveryChecks, expectedHead);
  }

  public async getReviews(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryReviewsDto>> {
    return this.read({ ...ref, expectedHead, kind: 'reviews', correlation: this.correlation }, validateDeliveryReviews, expectedHead);
  }

  public async prepareMergeReady(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryMergeReadyDto>> {
    return this.read({ ...ref, expectedHead, kind: 'merge-ready', correlation: this.correlation }, validateDeliveryMergeReady, expectedHead);
  }

  public async readAfterMerge(ref: PullRequestRef, expectedHead: string): Promise<PortResult<DeliveryAfterMergeDto>> {
    return this.read({ ...ref, expectedHead, kind: 'after-merge', correlation: this.correlation }, validateDeliveryAfterMerge, expectedHead);
  }

  private async read<T extends object>(
    request: GithubRequest,
    validate: (value: unknown) => value is T,
    expectedHead?: string,
  ): Promise<PortResult<T>> {
    let response: unknown;
    try {
      response = await this.transport.request(request);
    } catch {
      return unknown('github.transport.unavailable');
    }
    try {
      const result = validatePortResult<T>(response, validate);
      if (result.kind === 'unknown') return result;
      const observedCorrelation = (result.value as T & { correlation?: unknown }).correlation;
      if (observedCorrelation === undefined) return unknown('github.correlation.missing');
      const mismatch = reconcileCorrelation(this.correlation, observedCorrelation);
      if (mismatch !== null) return unknown(mismatch.code);
      const observedHead = 'headSha' in result.value ? result.value.headSha : 'expectedHead' in result.value ? result.value.expectedHead : undefined;
      if (expectedHead !== undefined && observedHead !== undefined && observedHead !== expectedHead) return unknown('github.head.stale');
      return result;
    } catch {
      return unknown('github.response.malformed');
    }
  }
}

export type GithubAdapter = ControlledGithubAdapter;
