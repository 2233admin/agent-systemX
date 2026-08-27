import type { EvidenceRef } from '../core/result.ts';
import { isRfc3339Timestamp, validateEvidenceRef } from '../core/result.ts';

/** 绑定一次实现审查所使用的确定性 BASE..HEAD 范围。 */
export interface ReviewPackage {
  readonly planId: string;
  readonly taskId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly path: string;
  readonly createdAt: string;
}

export interface ResidualClosure {
  readonly owner: string;
  readonly decision: string;
  readonly target: string;
  readonly closureEvidence: EvidenceRef | readonly EvidenceRef[];
}

export function validateResidualClosure(value: unknown): value is ResidualClosure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!nonEmpty(candidate.owner) || !nonEmpty(candidate.decision) || !nonEmpty(candidate.target)) return false;
  const evidence = Array.isArray(candidate.closureEvidence)
    ? candidate.closureEvidence
    : [candidate.closureEvidence];
  if (evidence.length === 0) return false;
  for (let index = 0; index < evidence.length; index += 1) {
    if (!(index in evidence)) return false;
    const item = evidence[index];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const source = (item as Record<string, unknown>).source;
    if (typeof source !== 'string' || source.trim().length === 0) return false;
    try {
      validateEvidenceRef(item as EvidenceRef);
    } catch {
      return false;
    }
  }
  return true;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 识别容易把相对引用误当作实现前 BASE 的猜测性范围。 */
export function isConcreteRevision(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{16,64}$/i.test(value.trim());
}

export function validateReviewPackage(value: unknown): value is ReviewPackage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return nonEmpty(candidate.planId)
    && nonEmpty(candidate.taskId)
    && isConcreteRevision(candidate.baseSha)
    && isConcreteRevision(candidate.headSha)
    && nonEmpty(candidate.path)
    && isRfc3339Timestamp(candidate.createdAt);
}

/** 创建已由调用方观测并提供时间戳的 review package；不生成时间或写入文件。 */
export function createReviewPackage(input: ReviewPackage): ReviewPackage {
  if (!validateReviewPackage(input)) {
    throw new TypeError('ReviewPackage requires plan/task, concrete BASE..HEAD, path, and RFC 3339 createdAt');
  }
  return { ...input };
}
