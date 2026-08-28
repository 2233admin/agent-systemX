export interface ControlPlaneUnknown {
  readonly kind: 'unknown';
  readonly reasonCode: string;
  readonly observedAt: string;
  readonly recovery: string;
}

export interface ConfigRevisionRef {
  readonly revisionId: string;
  readonly schemaVersion: number;
  readonly clientId: 'omp' | 'claude';
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface AssemblyManifestRef {
  readonly revisionId: string;
  readonly clientId: 'omp' | 'claude';
  readonly manifestDigest: string;
  readonly itemCount: number;
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface ClientCapability {
  readonly clientId: 'omp' | 'claude' | 'codex' | 'opencode';
  readonly clientVersion: string;
  readonly status: 'supported' | 'degraded' | 'unsupported' | 'unknown';
  readonly source: string;
  readonly sourceVersion: string;
  readonly reasonCode?: string;
  readonly observedAt: string;
}

export interface LaunchPlanRef {
  readonly revisionId: string;
  readonly clientId: 'omp' | 'claude';
  readonly planDigest: string;
  readonly launchBoundary: 'invocation-scoped';
  readonly source: string;
  readonly sourceVersion: string;
  readonly observedAt: string;
}

export interface ControlPlaneFacade {
  readConfigRevision(revisionId: string, clientId: 'omp' | 'claude'): Promise<ConfigRevisionRef | ControlPlaneUnknown>;
  readAssemblyManifest(revisionId: string, clientId: 'omp' | 'claude'): Promise<AssemblyManifestRef | ControlPlaneUnknown>;
  probeClient(clientId: 'omp' | 'claude' | 'codex' | 'opencode'): Promise<ClientCapability | ControlPlaneUnknown>;
  prepareLaunch(revisionId: string, clientId: 'omp' | 'claude'): Promise<LaunchPlanRef | ControlPlaneUnknown>;
}
