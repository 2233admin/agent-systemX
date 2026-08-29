export class InvalidActivationTransitionError extends Error {
  readonly kind = 'invalid-activation-transition' as const;

  constructor(readonly phase: string, readonly event: string) {
    super(`invalid activation transition: ${phase} -> ${event}`);
    this.name = 'InvalidActivationTransitionError';
  }
}

export class ConcurrencyConflictError extends Error {
  readonly kind = 'concurrency-conflict' as const;

  constructor(readonly aggregateId: string, readonly expectedVersion: number) {
    super(`concurrent write rejected for ${aggregateId} at version ${expectedVersion}`);
    this.name = 'ConcurrencyConflictError';
  }
}
export class InvalidActivationVersionError extends Error {
  readonly kind = 'invalid-activation-version' as const;

  constructor(readonly aggregateId: string, readonly expectedVersion: number, readonly receivedVersion: number) {
    super(`activation operation ${aggregateId} must advance from version ${expectedVersion} to ${expectedVersion + 1}, received ${receivedVersion}`);
    this.name = 'InvalidActivationVersionError';
  }
}
