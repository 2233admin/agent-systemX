import type { LaunchObservation } from '../../domain/launch-observation';

export interface LaunchObservationRepository {
  append(observation: LaunchObservation): Promise<void>;
  listByOperation(operationId: string): Promise<readonly LaunchObservation[]>;
}
