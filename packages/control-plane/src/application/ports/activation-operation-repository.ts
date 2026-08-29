import type { ActivationOperation } from '../../domain/activation-operation';
import type { ClientId } from '../../domain/client';

export interface ActivationOperationRepository {
  insert(operation: ActivationOperation): Promise<void>;
  updateIfVersion(operationId: string, expectedVersion: number, nextState: ActivationOperation): Promise<void>;
  claimApplying(operationId: string, expectedVersion: number, claimedAt: string): Promise<ActivationOperation>;
  findById(operationId: string): Promise<ActivationOperation | null>;
  findLatestForClient(clientId: ClientId): Promise<ActivationOperation | null>;
  findLatest(): Promise<ActivationOperation | null>;
}

