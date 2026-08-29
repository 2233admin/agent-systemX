import { createHash } from 'node:crypto';
import { defaultDbPath } from '../cli/db-path';
import { SqliteStore } from '../adapters/sqlite/store';
import { SqliteConfigRevisionRepository } from '../adapters/sqlite/repository';
import { SqliteActivationOperationRepository } from '../adapters/sqlite/activation-operation-repository';
import { SqliteLaunchObservationRepository } from '../adapters/sqlite/launch-observation-repository';
import { OmpClientAdapter, ClaudeClientAdapter, InMemoryClientAdapterRegistry } from '../adapters/clients/client-adapters';
import { prepareActivation } from './activation';
import { clientId as toClientId } from '../domain/client';
import type { ExistingPublicApplicationPorts, HarnessControlPlanePort } from './ports/harness';
import { createHarnessControlPlaneFacade } from './harness-facade';

function unavailable(reasonCode: string) { return { kind: 'unknown' as const, reasonCode, observedAt: new Date().toISOString(), recovery: 'repair or re-probe local control-plane dependencies' }; }

export async function createProductionHarnessControlPlaneFacade(): Promise<HarnessControlPlanePort> {
  let store: SqliteStore;
  try { store = new SqliteStore(defaultDbPath()); } catch { return createHarnessControlPlaneFacade({ readRevision: async () => unavailable('control-plane.dependencies.unavailable'), readManifest: async () => unavailable('control-plane.manifest.unavailable'), probe: async () => unavailable('control-plane.capability.unavailable'), planLaunch: async () => unavailable('control-plane.launch.unavailable') }); }
  const configurations = new SqliteConfigRevisionRepository(store);
  const operations = new SqliteActivationOperationRepository(store);
  const observations = new SqliteLaunchObservationRepository(store);
  const adapters = new InMemoryClientAdapterRegistry([new OmpClientAdapter(), new ClaudeClientAdapter()]);
  const sourceVersion = '1';
  const publicPorts: ExistingPublicApplicationPorts = {
    readRevision: async (revisionId, clientId) => {
      try { return await configurations.findById(revisionId) === null ? unavailable('control-plane.revision.missing') : { revisionId, schemaVersion: 1, clientId, source: 'control-plane', sourceVersion, observedAt: new Date().toISOString() }; } catch { return unavailable('control-plane.revision.unavailable'); }
    },
    readManifest: async (revisionId, clientId) => {
      try { const revision = await configurations.findById(revisionId); if (revision === null) return unavailable('control-plane.manifest.revision-missing'); const digest = createHash('sha256').update(JSON.stringify({ revisionId, clientId, capabilities: revision.capabilities })).digest('hex'); return { revisionId, clientId, manifestDigest: digest, itemCount: revision.capabilities.length, source: 'control-plane', sourceVersion, observedAt: new Date().toISOString() }; } catch { return unavailable('control-plane.manifest.unavailable'); }
    },
    probe: async (requestedClientId) => {
      try {
        const adapter = requestedClientId === 'claude' ? adapters.get(toClientId('claude-code')) : requestedClientId === 'omp' ? adapters.get(toClientId('omp')) : null;
        if (adapter === null) return { clientId: requestedClientId, clientVersion: 'unknown', status: 'unsupported', source: 'control-plane', sourceVersion, reasonCode: 'control-plane.client.unsupported', observedAt: new Date().toISOString() };
        const capability = await adapter.probe();
        return { clientId: requestedClientId, clientVersion: capability.version.kind === 'known' ? capability.version.value : 'unknown', status: capability.level, source: 'control-plane', sourceVersion, reasonCode: capability.reason, observedAt: new Date().toISOString() };
      } catch { return unavailable('control-plane.capability.unavailable'); }
    },
    planLaunch: async (revisionId, requestedClientId) => {
      try { const operation = await prepareActivation({ configurations, operations, observations, adapters }, { revisionId, clientId: requestedClientId === 'claude' ? 'claude-code' : 'omp' }); return { revisionId, clientId: requestedClientId, planDigest: operation.planHash, launchBoundary: 'invocation-scoped', source: 'control-plane', sourceVersion, observedAt: new Date().toISOString() }; } catch { return unavailable('control-plane.launch.unavailable'); }
    },
  };
  return createHarnessControlPlaneFacade(publicPorts);
}
