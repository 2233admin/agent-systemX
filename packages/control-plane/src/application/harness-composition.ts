import { createHash } from 'node:crypto';
import { defaultDbPath } from '../cli/db-path';
import { SqliteConfigRevisionRepository } from '../adapters/sqlite/repository';
import { SqliteLaunchPlanRepository } from '../adapters/sqlite/launch-repository';
import { BunOmpCapabilityProbe } from '../adapters/omp/capability-probe';
import { BunOmpProcessPort } from '../adapters/omp/process-port';
import { BunClaudeCapabilityProbe } from '../adapters/clients/claude/capability-probe';
import { BunClaudeProcessPort } from '../adapters/clients/claude/process-port';
import { prepareLaunchPlan } from './launch';
import type { ExistingPublicApplicationPorts } from './ports';
import { createHarnessControlPlaneFacade } from './harness-facade';
import type { HarnessControlPlanePort } from './ports';
import { isKnown } from '../domain/facts';

function unavailable(reasonCode: string) {
  return { kind: 'unknown' as const, reasonCode, observedAt: new Date().toISOString(), recovery: 'repair or re-probe local control-plane dependencies' };
}

export async function createProductionHarnessControlPlaneFacade(): Promise<HarnessControlPlanePort> {
  let configRepository: SqliteConfigRevisionRepository;
  let launchPlanRepository: SqliteLaunchPlanRepository;
  try {
    const dbPath = defaultDbPath();
    configRepository = new SqliteConfigRevisionRepository(dbPath);
    launchPlanRepository = new SqliteLaunchPlanRepository(dbPath);
  } catch {
    return createHarnessControlPlaneFacade({
      readRevision: async () => unavailable('control-plane.dependencies.unavailable'),
      readManifest: async () => unavailable('control-plane.manifest.unavailable'),
      probe: async () => unavailable('control-plane.capability.unavailable'),
      planLaunch: async () => unavailable('control-plane.launch.unavailable'),
    });
  }
  const ompPort = new BunOmpProcessPort();
  const claudeProcessPort = new BunClaudeProcessPort();
  const ompProbe = new BunOmpCapabilityProbe();
  const claudeProbe = new BunClaudeCapabilityProbe(claudeProcessPort);
  const sourceVersion = '1';
  const observedAt = new Date().toISOString();
  const publicPorts: ExistingPublicApplicationPorts = {
    readRevision: async (revisionId) => {
      try {
        const revision = await configRepository.findById(revisionId);
        return revision === null
          ? unavailable('control-plane.revision.missing')
          : { revisionId, schemaVersion: 1, clientId: 'omp', source: 'control-plane', sourceVersion, observedAt };
      } catch {
        return unavailable('control-plane.revision.unavailable');
      }
    },
    readManifest: async (revisionId, clientId) => {
      try {
        const revision = await configRepository.findById(revisionId);
        if (revision === null) return unavailable('control-plane.manifest.revision-missing');
        const probes = clientId === 'claude' ? await claudeProbe.probeHardControlCapabilities() : [];
        const digest = createHash('sha256').update(JSON.stringify({ revisionId, clientId, skills: revision.skills.map((skill) => skill.name), probes: probes.map((probe) => probe.status) })).digest('hex');
        return { revisionId, clientId, manifestDigest: digest, itemCount: revision.instructions.length + revision.skills.length + revision.mcp.length + revision.hooks.length + revision.plugins.length, source: 'control-plane', sourceVersion, observedAt };
      } catch {
        return unavailable('control-plane.manifest.unavailable');
      }
    },
    probe: async (clientId) => {
      try {
        if (clientId === 'omp') {
          const [version, capability] = await Promise.all([ompPort.detectVersion(), ompProbe.probeStatusViewingCapability()]);
          return { clientId, clientVersion: isKnown(version) ? version.value : 'unknown', status: capability.level, source: 'control-plane', sourceVersion, reasonCode: capability.reason, observedAt };
        }
        if (clientId === 'claude') {
          const [version, probes] = await Promise.all([claudeProcessPort.detectVersion(), claudeProbe.probeHardControlCapabilities()]);
          const failed = probes.find((probe) => probe.status !== 'supported');
          return { clientId, clientVersion: isKnown(version) ? version.value : 'unknown', status: failed?.status ?? 'supported', source: 'control-plane', sourceVersion, reasonCode: failed?.evidenceRef, observedAt };
        }
        return { clientId, clientVersion: 'unknown', status: 'unsupported', source: 'control-plane', sourceVersion, reasonCode: 'control-plane.client.unsupported', observedAt };
      } catch {
        return unavailable('control-plane.capability.unavailable');
      }
    },
    planLaunch: async (revisionId, clientId) => {
      try {
        const plan = await prepareLaunchPlan({ configRepository, launchPlanRepository }, { revisionId, client: clientId === 'claude' ? 'claude-code' : 'omp' });
        return { revisionId, clientId, planDigest: plan.planHash, launchBoundary: 'invocation-scoped', source: 'control-plane', sourceVersion, observedAt };
      } catch {
        return unavailable('control-plane.launch.unavailable');
      }
    },
  };
  return createHarnessControlPlaneFacade(publicPorts);
}
