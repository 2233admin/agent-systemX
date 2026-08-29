import { cp, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

import type { CapabilityReference } from '../../../domain/capability';
import type { ConfigurationRevision } from '../../../domain/configuration';
import { defaultSupplyRoot, describeSupplyRefRejection, validateSupplyRelativeRef } from '../../../cli/supply-root';
import { writeToSameDirTempFile } from '../../system/atomic-write';

const MATERIALIZED_DIR_NAME = 'materialized';

/** 无法物化的引用及稳定失败原因。 */
export interface ClaudeMaterializationFailure {
  readonly name: string;
  readonly reason: string;
}

export interface ClaudeMaterializedInstructions {
  /** 按引用顺序拼接的指令文本；没有成功内容时为 null。 */
  readonly appendSystemPromptText: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeMaterializedSkills {
  /** 至少成功复制一个 Skill 时的插件目录绝对路径。 */
  readonly pluginDirPath: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeMaterializedMcp {
  /** 至少成功解析一个 MCP 服务时的配置文件绝对路径。 */
  readonly mcpConfigPath: string | null;
  readonly failures: readonly ClaudeMaterializationFailure[];
}

export interface ClaudeContentMaterializationResult {
  readonly instructions: ClaudeMaterializedInstructions;
  readonly skills: ClaudeMaterializedSkills;
  readonly mcp: ClaudeMaterializedMcp;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Never a path separator or a leading-dot traversal segment -- every skill gets its own real, collision-safe subdirectory name. */
function sanitizePathSegment(name: string): string {
  const cleaned = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

function resolveSourcePath(
  reference: CapabilityReference,
  supplyRoot: string,
): { readonly path: string } | { readonly reason: string } {
  if (reference.sourceRef === undefined) {
    return { reason: `sourceRef 未知：${reference.name}` };
  }
  const value = reference.sourceRef;
  const verdict = validateSupplyRelativeRef(value, supplyRoot);
  if (!verdict.ok) {
    return { reason: describeSupplyRefRejection(value, supplyRoot, verdict.why) };
  }
  return { path: verdict.path };
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = await writeToSameDirTempFile(filePath, content);
  await rename(tempPath, filePath);
}

async function materializeInstructions(
  references: readonly CapabilityReference[],
  supplyRoot: string,
): Promise<ClaudeMaterializedInstructions> {
  if (references.length === 0) {
    return { appendSystemPromptText: null, failures: [] };
  }

  const failures: ClaudeMaterializationFailure[] = [];
  const texts: string[] = [];

  for (const reference of references) {
    const resolved = resolveSourcePath(reference, supplyRoot);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    try {
      texts.push(await readFile(resolved.path, 'utf8'));
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法读取指令文件：${errorMessage(error)}` });
    }
  }

  return { appendSystemPromptText: texts.length > 0 ? texts.join('\n\n') : null, failures };
}

async function materializeSkills(
  references: readonly CapabilityReference[],
  invocationDir: string,
  supplyRoot: string,
): Promise<ClaudeMaterializedSkills> {
  if (references.length === 0) {
    return { pluginDirPath: null, failures: [] };
  }

  const pluginDir = path.join(invocationDir, MATERIALIZED_DIR_NAME, 'plugin');
  const skillsDir = path.join(pluginDir, 'skills');
  const failures: ClaudeMaterializationFailure[] = [];
  const targetNames = new Set<string>();
  let anySucceeded = false;
  for (const reference of references) {
    const resolved = resolveSourcePath(reference, supplyRoot);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    const targetName = sanitizePathSegment(reference.name);
    if (targetNames.has(targetName)) {
      failures.push({ name: reference.name, reason: '技能名称映射冲突' });
      continue;
    }
    targetNames.add(targetName);
    const targetDir = path.join(skillsDir, targetName);
    try {
      await cp(resolved.path, targetDir, { recursive: true });
      anySucceeded = true;
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法复制 Skill 目录：${errorMessage(error)}` });
    }
  }

  if (!anySucceeded) {
    return { pluginDirPath: null, failures };
  }

  const pluginManifest = {
    name: 'agent-system-materialized-skills',
    version: '1.0.0',
    description: 'Agent System 本次 fresh 启动物化的 Skills（AD-21）',
    skills: './skills/',
  };
  try {
    await writeFileAtomic(path.join(pluginDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginManifest, null, 2)}\n`);
  } catch (error) {
    failures.push({ name: '.claude-plugin/plugin.json', reason: `无法写入 plugin.json：${errorMessage(error)}` });
    return { pluginDirPath: null, failures };
  }

  return { pluginDirPath: pluginDir, failures };
}

async function materializeMcp(
  references: readonly CapabilityReference[],
  invocationDir: string,
  supplyRoot: string,
): Promise<ClaudeMaterializedMcp> {
  if (references.length === 0) {
    return { mcpConfigPath: null, failures: [] };
  }

  const failures: ClaudeMaterializationFailure[] = [];
  const mcpServers: Record<string, unknown> = {};

  for (const reference of references) {
    const resolved = resolveSourcePath(reference, supplyRoot);
    if ('reason' in resolved) {
      failures.push({ name: reference.name, reason: resolved.reason });
      continue;
    }
    try {
      const text = await readFile(resolved.path, 'utf8');
      mcpServers[reference.name] = JSON.parse(text);
    } catch (error) {
      failures.push({ name: reference.name, reason: `无法读取/解析 MCP 服务器定义：${errorMessage(error)}` });
    }
  }

  if (Object.keys(mcpServers).length === 0) {
    return { mcpConfigPath: null, failures };
  }

  const mcpConfigPath = path.join(invocationDir, MATERIALIZED_DIR_NAME, 'mcp.json');
  try {
    await writeFileAtomic(mcpConfigPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
  } catch (error) {
    failures.push({ name: 'mcp.json', reason: `无法写入 mcp.json：${errorMessage(error)}` });
    return { mcpConfigPath: null, failures };
  }
  return { mcpConfigPath, failures };
}

export async function materializeClaudeContent(
  revision: ConfigurationRevision,
  invocationDir: string,
): Promise<ClaudeContentMaterializationResult> {
  const supplyRoot = defaultSupplyRoot();
  const [instructions, skills, mcp] = await Promise.all([
    materializeInstructions(revision.capabilities.filter((reference) => reference.kind === 'instruction'), supplyRoot),
    materializeSkills(revision.capabilities.filter((reference) => reference.kind === 'skill'), invocationDir, supplyRoot),
    materializeMcp(revision.capabilities.filter((reference) => reference.kind === 'mcp'), invocationDir, supplyRoot),
  ]);
  return { instructions, skills, mcp };
}

export class FsClaudeContentMaterializer {
  async materialize(revision: ConfigurationRevision, invocationDir: string): Promise<ClaudeContentMaterializationResult> {
    return materializeClaudeContent(revision, invocationDir);
  }
}
