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

function isUnknown(value: unknown): value is HarnessUnknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'unknown'
    && typeof (value as Record<string, unknown>).reasonCode === 'string'
    && typeof (value as Record<string, unknown>).observedAt === 'string'
    && typeof (value as Record<string, unknown>).recovery === 'string';
}

function hasOnly(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((field) => fields.includes(field));
}

function isRevision(value: unknown): value is HarnessConfigRevisionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return hasOnly(candidate, ['revisionId', 'schemaVersion', 'clientId', 'observedAt'])
    && typeof candidate.revisionId === 'string'
    && typeof candidate.schemaVersion === 'number'
    && (candidate.clientId === 'omp' || candidate.clientId === 'claude')
    && typeof candidate.observedAt === 'string';
}

function isManifest(value: unknown): value is HarnessAssemblyManifestRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return hasOnly(candidate, ['revisionId', 'clientId', 'manifestDigest', 'itemCount', 'observedAt'])
    && typeof candidate.revisionId === 'string'
    && (candidate.clientId === 'omp' || candidate.clientId === 'claude')
    && typeof candidate.manifestDigest === 'string'
    && typeof candidate.itemCount === 'number'
    && Number.isInteger(candidate.itemCount)
    && typeof candidate.observedAt === 'string';
}

function isCapability(value: unknown): value is HarnessClientCapability {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return hasOnly(candidate, ['clientId', 'clientVersion', 'status', 'reasonCode', 'observedAt'])
    && typeof candidate.clientId === 'string'
    && typeof candidate.clientVersion === 'string'
    && ['supported', 'degraded', 'unsupported', 'unknown'].includes(String(candidate.status))
    && typeof candidate.observedAt === 'string'
    && (candidate.reasonCode === undefined || typeof candidate.reasonCode === 'string');
}

function isLaunchPlan(value: unknown): value is HarnessLaunchPlanRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).revisionId === 'string'
    && ((value as Record<string, unknown>).clientId === 'omp' || (value as Record<string, unknown>).clientId === 'claude')
    && typeof (value as Record<string, unknown>).planDigest === 'string'
    && (value as Record<string, unknown>).launchBoundary === 'invocation-scoped'
    && typeof (value as Record<string, unknown>).observedAt === 'string';
}

export function createHarnessControlPlaneFacade(ports: ExistingPublicApplicationPorts): HarnessControlPlanePort {
  return {
    async readConfigRevision(revisionId) {
      try {
        const value = await ports.readRevision(revisionId);
        return isUnknown(value) ? value : isRevision(value) ? value : unknown('control-plane.revision.shape-invalid');
      } catch {
        return unknown('control-plane.revision.unavailable');
      }
    },
    async readAssemblyManifest(revisionId, clientId) {
      try {
        const value = await ports.readManifest(revisionId, clientId);
        return isUnknown(value) ? value : isManifest(value) ? value : unknown('control-plane.manifest.shape-invalid');
      } catch {
        return unknown('control-plane.manifest.unavailable');
      }
    },
    async probeClient(clientId) {
      try {
        const value = await ports.probe(clientId);
        return isUnknown(value) ? value : isCapability(value) ? value : unknown('control-plane.capability.shape-invalid');
      } catch {
        return unknown('control-plane.capability.unavailable');
      }
    },
    async prepareLaunch(revisionId, clientId) {
      try {
        const value = await ports.planLaunch(revisionId, clientId);
        return isUnknown(value) ? value : isLaunchPlan(value) ? value : unknown('control-plane.launch.shape-invalid');
      } catch {
        return unknown('control-plane.launch.unavailable');
      }
    },
  };
}
