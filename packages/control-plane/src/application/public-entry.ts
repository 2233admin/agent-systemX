import { openDeps } from '../cli/index';
import { createHarnessControlPlaneFacade } from './harness-facade';
import type { HarnessControlPlanePort } from './ports';

export { createHarnessControlPlaneFacade } from './harness-facade';
export type {
  ExistingPublicApplicationPorts,
  HarnessAssemblyManifestRef,
  HarnessClientCapability,
  HarnessConfigRevisionRef,
  HarnessControlPlanePort,
  HarnessControlPlanePortFactory,
  HarnessLaunchPlanRef,
  HarnessUnknown,
} from './ports';

export async function createProductionHarnessControlPlaneFacade(): Promise<HarnessControlPlanePort> {
  const deps = await openDeps({});
  const now = () => new Date().toISOString();
  if (deps === null) {
    return createHarnessControlPlaneFacade({
      readRevision: async () => ({ kind: 'unknown', reasonCode: 'control-plane.dependencies.unavailable', observedAt: now(), recovery: 'repair local control-plane dependencies' }),
      readManifest: async () => ({ kind: 'unknown', reasonCode: 'control-plane.manifest.unavailable', observedAt: now(), recovery: 'provide a readable local assembly manifest' }),
      probe: async () => ({ kind: 'unknown', reasonCode: 'control-plane.capability.unavailable', observedAt: now(), recovery: 'probe the local client again' }),
      planLaunch: async () => ({ kind: 'unknown', reasonCode: 'control-plane.launch.unavailable', observedAt: now(), recovery: 'provide a readable local launch plan' }),
    });
  }
  return createHarnessControlPlaneFacade({
    readRevision: async (revisionId) => {
      const revision = await deps.configRepository.findById(revisionId);
      return revision === null
        ? { kind: 'unknown', reasonCode: 'control-plane.revision.missing', observedAt: now(), recovery: 'provide an existing revision id' }
        : { revisionId, schemaVersion: 1, clientId: 'omp', source: 'control-plane', sourceVersion: '1', observedAt: now() };
    },
    readManifest: async () => ({ kind: 'unknown', reasonCode: 'control-plane.manifest.not-available', observedAt: now(), recovery: 'provide a public assembly manifest read port' }),
    probe: async (clientId) => {
      if (clientId === 'omp') {
        const probe = await deps.capabilityProbe.probeStatusViewingCapability();
        return { clientId, clientVersion: 'unknown', status: probe.level, source: 'control-plane', sourceVersion: '1', reasonCode: probe.reason, observedAt: now() };
      }
      if (clientId === 'claude') {
        const probes = await deps.claudeCapabilityProbe.probeHardControlCapabilities();
        const failed = probes.find((probe) => probe.status !== 'supported');
        return { clientId, clientVersion: 'unknown', status: failed?.status ?? 'unknown', source: 'control-plane', sourceVersion: '1', reasonCode: failed?.evidenceRef ?? 'claude.capability.unavailable', observedAt: now() };
      }
      return { clientId, clientVersion: 'unknown', status: 'unsupported', source: 'control-plane', sourceVersion: '1', reasonCode: 'control-plane.client.unsupported', observedAt: now() };
    },
    planLaunch: async () => ({ kind: 'unknown', reasonCode: 'control-plane.launch.not-available', observedAt: now(), recovery: 'provide a public launch-plan read port' }),
  });
}
