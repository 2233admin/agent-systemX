import { isRfc3339Timestamp } from '../core/result.ts';

export interface ExecutionLease {
  readonly kind: 'execution';
  readonly workflowId: string;
  readonly planId: string;
  readonly holderId: string;
  readonly worktreePath: string;
  readonly fencingToken: number;
  readonly claimedAt: string;
}

export interface IntegrationMergeLease {
  readonly kind: 'integration-merge';
  readonly workflowId: string;
  readonly integrationBranch: string;
  readonly holderId: string;
  readonly fencingToken: number;
  readonly claimedAt: string;
}

export type Lease = ExecutionLease | IntegrationMergeLease;

export type ExecutionLeaseClaim = Omit<ExecutionLease, 'fencingToken'> & {
  readonly lastFencingToken?: number;
};

export type IntegrationMergeLeaseClaim = Omit<IntegrationMergeLease, 'fencingToken'> & {
  readonly lastFencingToken?: number;
};

export type LeaseClaim = ExecutionLeaseClaim | IntegrationMergeLeaseClaim;

export interface LeaseState {
  readonly lease?: Lease;
  readonly fencingToken?: number;
}

export interface StaleProof {
  readonly reason?: string;
  readonly observedAt?: string;
  readonly [key: string]: unknown;
}

export interface ClaimedLease<T extends Lease = Lease> {
  readonly kind: 'claimed';
  readonly lease: T;
}

export interface ResumedLease<T extends Lease = Lease> {
  readonly kind: 'resumed';
  readonly lease: T;
}

export interface BlockedLease {
  readonly kind: 'blocked';
  readonly reason: string;
}

export type LeaseClaimResult<T extends Lease = Lease> = ClaimedLease<T> | ResumedLease<T> | BlockedLease;

export interface ReleasedLease {
  readonly kind: 'released';
  readonly fencingToken: number;
}

export type LeaseReleaseResult = ReleasedLease | BlockedLease;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validClaimedAt(value: unknown): value is string {
  return nonEmptyString(value) && isRfc3339Timestamp(value);
}

function hasOnlyKeys(candidate: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(candidate).every((key) => allowed.includes(key));
}

export function validateLease(value: unknown): value is Lease {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!nonEmptyString(candidate.workflowId)
    || !nonEmptyString(candidate.holderId)
    || !validToken(candidate.fencingToken)
    || !validClaimedAt(candidate.claimedAt)) {
    return false;
  }
  if (candidate.kind === 'execution') {
    return hasOnlyKeys(candidate, ['kind', 'workflowId', 'planId', 'holderId', 'worktreePath', 'fencingToken', 'claimedAt'])
      && nonEmptyString(candidate.planId)
      && nonEmptyString(candidate.worktreePath);
  }
  if (candidate.kind === 'integration-merge') {
    return hasOnlyKeys(candidate, ['kind', 'workflowId', 'integrationBranch', 'holderId', 'fencingToken', 'claimedAt'])
      && nonEmptyString(candidate.integrationBranch);
  }
  return false;
}
function validClaim(value: unknown): value is LeaseClaim {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!nonEmptyString(candidate.workflowId)
    || !nonEmptyString(candidate.holderId)
    || !validClaimedAt(candidate.claimedAt)) {
    return false;
  }
  const lastFencingToken = candidate.lastFencingToken;
  if (lastFencingToken !== undefined
    && (typeof lastFencingToken !== 'number' || !Number.isSafeInteger(lastFencingToken) || lastFencingToken < 0)) {
    return false;
  }
  if (candidate.kind === 'execution') {
    return hasOnlyKeys(candidate, ['kind', 'workflowId', 'planId', 'holderId', 'worktreePath', 'claimedAt', 'lastFencingToken'])
      && nonEmptyString(candidate.planId)
      && nonEmptyString(candidate.worktreePath);
  }
  return candidate.kind === 'integration-merge'
    && hasOnlyKeys(candidate, ['kind', 'workflowId', 'integrationBranch', 'holderId', 'claimedAt', 'lastFencingToken'])
    && nonEmptyString(candidate.integrationBranch);
}

function isStaleProof(value: unknown): value is StaleProof | true {
  if (value === true) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
}
function currentIsValid(value: Lease | LeaseState | LeaseReleaseResult | undefined | null): boolean {
  if (value === undefined || value === null || validateLease(value)) return true;
  if (typeof value !== 'object') return false;
  if ('lease' in value) {
    const state = value as LeaseState;
    const stateRecord = value as unknown as Record<string, unknown>;
    const stateToken = stateRecord.fencingToken;
    return hasOnlyKeys(stateRecord, ['lease', 'fencingToken'])
      && (state.lease === undefined || validateLease(state.lease))
      && (stateToken === undefined
        || (typeof stateToken === 'number' && Number.isSafeInteger(stateToken) && stateToken >= 0));
  }
  if ('kind' in value && value.kind === 'released') {
    return validToken(value.fencingToken);
  }
  return false;
}

function asLease(value: Lease | LeaseState | LeaseReleaseResult | undefined | null): Lease | undefined {
  if (value === undefined || value === null) return undefined;
  if (validateLease(value)) return value;
  if (typeof value === 'object' && 'lease' in value) {
    const nested = (value as LeaseState).lease;
    return validateLease(nested) ? nested : undefined;
  }
  return undefined;
}
function priorToken(value: Lease | LeaseState | LeaseReleaseResult | undefined | null, claim: LeaseClaim): number {
  const current = asLease(value);
  const stateToken = typeof value === 'object' && value !== null && 'fencingToken' in value
    ? (value as { fencingToken?: unknown }).fencingToken
    : undefined;
  const claimToken = claim.lastFencingToken;
  return Math.max(
    current?.fencingToken ?? 0,
    typeof stateToken === 'number' && Number.isSafeInteger(stateToken) && stateToken >= 0 ? stateToken : 0,
    typeof claimToken === 'number' && Number.isSafeInteger(claimToken) && claimToken >= 0 ? claimToken : 0,
  );
}
function sameLeaseKey(current: Lease, claim: LeaseClaim): boolean {
  if (current.kind !== claim.kind || current.workflowId !== claim.workflowId) return false;
  if (current.kind === 'execution' && claim.kind === 'execution') {
    return current.planId === claim.planId && current.worktreePath === claim.worktreePath;
  }
  if (current.kind === 'integration-merge' && claim.kind === 'integration-merge') {
    return current.integrationBranch === claim.integrationBranch;
  }
  return false;
}
function sameLeaseIdentity(current: Lease, claim: LeaseClaim): boolean {
  if (!sameLeaseKey(current, claim) || current.holderId !== claim.holderId) return false;
  if (current.kind === 'execution' && claim.kind === 'execution') {
    return current.worktreePath === claim.worktreePath;
  }
  if (current.kind === 'integration-merge' && claim.kind === 'integration-merge') {
    return current.integrationBranch === claim.integrationBranch;
  }
  return false;
}

export function canStealLease(lease: unknown, staleProof?: unknown): boolean {
  return validateLease(lease) && isStaleProof(staleProof);
}
export function claimLease(
  current: Lease | LeaseState | LeaseReleaseResult | undefined | null,
  claim: LeaseClaim,
  staleProof?: StaleProof | true,
): LeaseClaimResult {
  if (!validClaim(claim)) return { kind: 'blocked', reason: 'Malformed lease claim' };
  if (!currentIsValid(current)) return { kind: 'blocked', reason: 'Current lease state is malformed' };
  const active = asLease(current);
  if (active !== undefined) {
    if (sameLeaseIdentity(active, claim)) return { kind: 'resumed', lease: active };
    if (active.kind === claim.kind && active.workflowId === claim.workflowId
      && active.kind === 'execution' && claim.kind === 'execution'
      && active.planId === claim.planId && active.holderId === claim.holderId) {
      return { kind: 'blocked', reason: 'Lease identity changed for the current holder' };
    }
    if (!canStealLease(active, staleProof)) return { kind: 'blocked', reason: 'Active lease is held by another holder' };
  }

  const fencingToken = priorToken(current, claim) + 1;
  if (!Number.isSafeInteger(fencingToken)) return { kind: 'blocked', reason: 'Fencing token exhausted' };
  if (claim.kind === 'execution') {
    return {
      kind: 'claimed',
      lease: {
        kind: 'execution',
        workflowId: claim.workflowId,
        planId: claim.planId,
        holderId: claim.holderId,
        worktreePath: claim.worktreePath,
        fencingToken,
        claimedAt: claim.claimedAt,
      },
    };
  }
  return {
    kind: 'claimed',
    lease: {
      kind: 'integration-merge',
      workflowId: claim.workflowId,
      integrationBranch: claim.integrationBranch,
      holderId: claim.holderId,
      fencingToken,
      claimedAt: claim.claimedAt,
    },
  };
}

export function releaseLease(
  current: Lease | LeaseState | undefined | null,
  holderId: string,
  fencingToken: number,
): LeaseReleaseResult {
  const active = asLease(current);
  if (active === undefined) return { kind: 'blocked', reason: 'No active lease to release' };
  if (!nonEmptyString(holderId) || active.holderId !== holderId || active.fencingToken !== fencingToken) {
    return { kind: 'blocked', reason: 'Lease holder or fencing token does not match' };
  }
  return { kind: 'released', fencingToken: active.fencingToken };
}
