export interface HarnessUnknown {
  readonly kind: 'unknown';
  readonly reasonCode: string;
  readonly observedAt: string;
  readonly recovery: string;
}

export type HarnessClientId = 'omp' | 'claude';
export type HarnessProbeClientId = HarnessClientId | 'codex' | 'opencode';

export interface HarnessConfigRevisionRef {
  readonly revisionId: string;
  readonly schemaVersion: number;
  readonly clientId: HarnessClientId;
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface HarnessAssemblyManifestRef {
  readonly revisionId: string;
  readonly clientId: HarnessClientId;
  readonly manifestDigest: string;
  readonly itemCount: number;
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface HarnessClientCapability {
  readonly clientId: HarnessProbeClientId;
  readonly clientVersion: string;
  readonly status: 'supported' | 'degraded' | 'unsupported' | 'unknown';
  readonly source: string;
  readonly sourceVersion: string;
  readonly reasonCode?: string;
  readonly observedAt: string;
}

export interface HarnessLaunchPlanRef {
  readonly revisionId: string;
  readonly clientId: HarnessClientId;
  readonly planDigest: string;
  readonly launchBoundary: 'invocation-scoped';
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface HarnessControlPlanePort {
  readConfigRevision(revisionId: string, clientId: HarnessClientId): Promise<HarnessConfigRevisionRef | HarnessUnknown>;
  readAssemblyManifest(revisionId: string, clientId: HarnessClientId): Promise<HarnessAssemblyManifestRef | HarnessUnknown>;
  probeClient(clientId: HarnessProbeClientId): Promise<HarnessClientCapability | HarnessUnknown>;
  prepareLaunch(revisionId: string, clientId: HarnessClientId): Promise<HarnessLaunchPlanRef | HarnessUnknown>;
}

export interface ExistingPublicApplicationPorts {
  readonly readRevision: HarnessControlPlanePort['readConfigRevision'];
  readonly readManifest: HarnessControlPlanePort['readAssemblyManifest'];
  readonly probe: HarnessControlPlanePort['probeClient'];
  readonly planLaunch: HarnessControlPlanePort['prepareLaunch'];
}

export interface HarnessControlPlanePortFactory {
  createHarnessControlPlaneFacade(): HarnessControlPlanePort;
}
