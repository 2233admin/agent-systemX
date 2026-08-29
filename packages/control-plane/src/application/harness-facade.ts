import type { ExistingPublicApplicationPorts, HarnessAssemblyManifestRef, HarnessClientCapability, HarnessConfigRevisionRef, HarnessControlPlanePort, HarnessLaunchPlanRef, HarnessUnknown } from './ports/harness';

function unknownResult(reasonCode: string): HarnessUnknown {
  return { kind: 'unknown', reasonCode, observedAt: new Date().toISOString(), recovery: 're-read the public control-plane facade inputs' };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validUnknown(value: unknown): value is HarnessUnknown { return record(value) && value.kind === 'unknown' && typeof value.reasonCode === 'string' && typeof value.observedAt === 'string' && typeof value.recovery === 'string'; }
function validRevision(value: unknown): value is HarnessConfigRevisionRef { return record(value) && typeof value.revisionId === 'string' && typeof value.schemaVersion === 'number' && (value.clientId === 'omp' || value.clientId === 'claude') && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string'; }
function validManifest(value: unknown): value is HarnessAssemblyManifestRef { return record(value) && typeof value.revisionId === 'string' && (value.clientId === 'omp' || value.clientId === 'claude') && typeof value.manifestDigest === 'string' && typeof value.itemCount === 'number' && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string'; }
function validCapability(value: unknown): value is HarnessClientCapability { return record(value) && typeof value.clientId === 'string' && typeof value.clientVersion === 'string' && ['supported', 'degraded', 'unsupported', 'unknown'].includes(String(value.status)) && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string'; }
function validPlan(value: unknown): value is HarnessLaunchPlanRef { return record(value) && typeof value.revisionId === 'string' && (value.clientId === 'omp' || value.clientId === 'claude') && typeof value.planDigest === 'string' && value.launchBoundary === 'invocation-scoped' && typeof value.source === 'string' && typeof value.sourceVersion === 'string' && typeof value.observedAt === 'string'; }
function projectUnknown(value: HarnessUnknown): HarnessUnknown { return { kind: value.kind, reasonCode: value.reasonCode, observedAt: value.observedAt, recovery: value.recovery }; }
function projectRevision(value: HarnessConfigRevisionRef): HarnessConfigRevisionRef { return { revisionId: value.revisionId, schemaVersion: value.schemaVersion, clientId: value.clientId, source: value.source, sourceVersion: value.sourceVersion, observedAt: value.observedAt }; }
function projectManifest(value: HarnessAssemblyManifestRef): HarnessAssemblyManifestRef { return { revisionId: value.revisionId, clientId: value.clientId, manifestDigest: value.manifestDigest, itemCount: value.itemCount, source: value.source, sourceVersion: value.sourceVersion, observedAt: value.observedAt }; }
function projectCapability(value: HarnessClientCapability): HarnessClientCapability { return { clientId: value.clientId, clientVersion: value.clientVersion, status: value.status, source: value.source, sourceVersion: value.sourceVersion, observedAt: value.observedAt, reasonCode: value.reasonCode }; }
function projectPlan(value: HarnessLaunchPlanRef): HarnessLaunchPlanRef { return { revisionId: value.revisionId, clientId: value.clientId, planDigest: value.planDigest, launchBoundary: value.launchBoundary, source: value.source, sourceVersion: value.sourceVersion, observedAt: value.observedAt }; }

export function createHarnessControlPlaneFacade(ports: ExistingPublicApplicationPorts): HarnessControlPlanePort {
  return {
    async readConfigRevision(revisionId, clientId) {
      try { const value = await ports.readRevision(revisionId, clientId); return validUnknown(value) ? projectUnknown(value) : validRevision(value) ? projectRevision(value) : unknownResult('control-plane.revision.shape-invalid'); } catch { return unknownResult('control-plane.revision.unavailable'); }
    },
    async readAssemblyManifest(revisionId, clientId) {
      try { const value = await ports.readManifest(revisionId, clientId); return validUnknown(value) ? projectUnknown(value) : validManifest(value) ? projectManifest(value) : unknownResult('control-plane.manifest.shape-invalid'); } catch { return unknownResult('control-plane.manifest.unavailable'); }
    },
    async probeClient(clientId) {
      try { const value = await ports.probe(clientId); return validUnknown(value) ? projectUnknown(value) : validCapability(value) ? projectCapability(value) : unknownResult('control-plane.capability.shape-invalid'); } catch { return unknownResult('control-plane.capability.unavailable'); }
    },
    async prepareLaunch(revisionId, clientId) {
      try { const value = await ports.planLaunch(revisionId, clientId); return validUnknown(value) ? projectUnknown(value) : validPlan(value) ? projectPlan(value) : unknownResult('control-plane.launch.shape-invalid'); } catch { return unknownResult('control-plane.launch.unavailable'); }
    },
  };
}
