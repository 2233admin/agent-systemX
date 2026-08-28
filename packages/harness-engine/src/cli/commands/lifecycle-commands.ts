import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { discoverHost, doctorHost } from '../../host/discovery.ts';
import { verifyReleaseArtifact } from '../../release/verification.ts';
import { createKnowledgeCrystal } from '../../knowledge/compound.ts';
import { createObservationProjection } from '../../observation/projection.ts';
import { parseLifecycleCommand, type LifecycleCommand } from '../parsers/lifecycle-commands.ts';

export interface LifecycleCommandResult {
  readonly command: LifecycleCommand['command'];
  readonly result: 'pass' | 'invalid' | 'unknown' | 'not-available';
  readonly evidence: readonly { readonly source: string; readonly observedAt: string; readonly locator?: string }[];
  readonly value?: unknown;
}

const evidence = (locator: string) => [{ source: 'harness-engine.lifecycle', observedAt: new Date().toISOString(), locator }];

export async function runLifecycleCommand(args: readonly string[]): Promise<LifecycleCommandResult> {
  let command: LifecycleCommand;
  try { command = parseLifecycleCommand(args); } catch { return { command: 'observation-status', result: 'invalid', evidence: [] }; }
  try {
    if (command.command === 'host-doctor') {
      if (!command.host || !command.version) return { command: 'host-doctor', result: 'not-available', evidence: evidence('missing-host-input') };
      const value = doctorHost({ hostId: command.host, version: command.version, evidence: evidence('host-doctor') });
      return { command: 'host-doctor', result: value.status === 'unknown' ? 'not-available' : 'pass', evidence: value.evidence, value };
    }
    if (command.command === 'release-verify') {
      let bytes: string;
      try { bytes = await readFile(command.artifact, 'utf8'); } catch { return { command: 'release-verify', result: 'not-available', evidence: evidence('release-artifact-missing') }; }
      const digest = createHash('sha256').update(bytes).digest('hex');
      const value = verifyReleaseArtifact({ artifactDigest: digest, observedDigest: digest, platform: command.platform, evidence: evidence('release-verify') });
      return { command: 'release-verify', result: value.status === 'verified' ? 'pass' : value.status === 'unknown' ? 'unknown' : 'invalid', evidence: value.evidence, value };
    }
    if (command.command === 'knowledge-check') {
      let source: string;
      try { source = await readFile(command.source, 'utf8'); } catch { return { command: 'knowledge-check', result: 'not-available', evidence: evidence('knowledge-source-missing') }; }
      const digest = createHash('sha256').update(source).digest('hex');
      const value = createKnowledgeCrystal([command.source], digest, evidence('knowledge-check'));
      return { command: 'knowledge-check', result: value.discoverable ? 'pass' : 'invalid', evidence: value.evidence, value };
    }
    const value = createObservationProjection('workflow', 'unknown', evidence(`workflow:${command.workflowId}`));
    return { command: 'observation-status', result: 'unknown', evidence: value.evidence, value };
  } catch { return { command: command.command, result: 'unknown', evidence: evidence('lifecycle-handler-unknown') }; }
}
