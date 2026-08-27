import type { WorkflowSnapshot } from '../domain/workflow';

export interface ArtifactStore {
  readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null>;
  writeWorkflow(expectedRevision: number, next: WorkflowSnapshot): Promise<void>;
}
