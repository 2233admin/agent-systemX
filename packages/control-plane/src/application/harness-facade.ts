import type {
  ExistingPublicApplicationPorts,
  HarnessAssemblyManifestRef,
  HarnessClientCapability,
  HarnessConfigRevisionRef,
  HarnessControlPlanePort,
  HarnessLaunchPlanRef,
  HarnessUnknown,
} from './ports';

function unknown(reasonCode: string): HarnessUnknown {
  return { kind: 'unknown', reasonCode, observedAt: new Date().toISOString(), recovery: 're-read the public control-plane facade inputs' };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((field) => fields.includes(field));
}

function isUnknown(value: unknown): value is HarnessUnknown {
  return record(value) && hasOnly(value, ['kind', 'reasonCode', 'observedAt', 'recovery'])
    && value.kind === 'unknown' && typeof value.reasonCode === 'string'
    && typeof value.observedAt === 'string' && typeof value.recovery === 'string';
}

function isRevision(value: unknown): value is HarnessConfigRevisionRef {
  if (!record(value)) return false;
  return hasOnly(value, ['revisionId', 'schemaVersion', 'clientId', 'source', 'sourceVersion', 'observedAt'])
    && typeof value.revisionId === 'string' && typeof value.schemaVersion === 'number'
    && (value.clientId === 'omp' || value.clientId === 'claude')
    && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string';
}

function isManifest(value: unknown): value is HarnessAssemblyManifestRef {
  if (!record(value)) return false;
  return hasOnly(value, ['revisionId', 'clientId', 'manifestDigest', 'itemCount', 'source', 'sourceVersion', 'observedAt'])
    && typeof value.revisionId === 'string' && (value.clientId === 'omp' || value.clientId === 'claude')
    && typeof value.manifestDigest === 'string' && typeof value.itemCount === 'number'
    && Number.isInteger(value.itemCount) && typeof value.source === 'string'
    && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string';
}

function isCapability(value: unknown): value is HarnessClientCapability {
  if (!record(value)) return false;
  return hasOnly(value, ['clientId', 'clientVersion', 'status', 'source', 'sourceVersion', 'reasonCode', 'observedAt'])
    && typeof value.clientId === 'string' && typeof value.clientVersion === 'string'
    && ['supported', 'degraded', 'unsupported', 'unknown'].includes(String(value.status))
    && typeof value.source === 'string' && typeof value.sourceVersion === 'string'
    && (value.reasonCode === undefined || typeof value.reasonCode === 'string') && typeof value.observedAt === 'string';
}

function isLaunchPlan(value: unknown): value is HarnessLaunchPlanRef {
  if (!record(value)) return false;
  return hasOnly(value, ['revisionId', 'clientId', 'planDigest', 'launchBoundary', 'source', 'sourceVersion', 'observedAt'])
    && typeof value.revisionId === 'string' && (value.clientId === 'omp' || value.clientId === 'claude')
    && typeof value.planDigest === 'string' && value.launchBoundary === 'invocation-scoped'
    && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string';
}

export function createHarnessControlPlaneFacade(ports: ExistingPublicApplicationPorts): HarnessControlPlanePort {
  return {
    async readConfigRevision(revisionId) {
      try { const value = await ports.readRevision(revisionId); return isUnknown(value) ? value : isRevision(value) ? value : unknown('control-plane.revision.shape-invalid'); }
      catch { return unknown('control-plane.revision.unavailable'); }
    },
    async readAssemblyManifest(revisionId, clientId) {
      try { const value = await ports.readManifest(revisionId, clientId); return isUnknown(value) ? value : isManifest(value) ? value : unknown('control-plane.manifest.shape-invalid'); }
      catch { return unknown('control-plane.manifest.unavailable'); }
    },
    async probeClient(clientId) {
      try { const value = await ports.probe(clientId); return isUnknown(value) ? value : isCapability(value) ? value : unknown('control-plane.capability.shape-invalid'); }
      catch { return unknown('control-plane.capability.unavailable'); }
    },
    async prepareLaunch(revisionId, clientId) {
      try { const value = await ports.planLaunch(revisionId, clientId); return isUnknown(value) ? value : isLaunchPlan(value) ? value : unknown('control-plane.launch.shape-invalid'); }
      catch { return unknown('control-plane.launch.unavailable'); }
    },
  };
}
