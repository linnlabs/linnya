import type {
  ObservationPreviewContext,
  ObservationPreviewMeta,
  ObservationPreviewPort,
} from '../../tools/ports';
import type {
  AgentSpecToolObservationGovernancePolicy,
  ObservationTruncationMeta,
} from '../../../contracts';
import { isRecord, readString } from './toolNode.helpers';

export const DEFAULT_TOOL_OBSERVATION_GOVERNANCE_POLICY = {
  /**
   * 执行期 observation 预览阈值。
   *
   * 中文说明：
   * - 这里控制“工具刚执行完后，原始 observation 多长就落盘到 ToolOutputStore”；
   * - 这是工具 output 的唯一尺寸治理点；上下文构建期只决定工具组保留/丢弃，不再二次改写 output。
   */
  enabled: true,
  maxChars: 20_000,
  maxLines: 1_200,
} as const;

export const TOOL_OBSERVATION_PREVIEW_LIMITS = DEFAULT_TOOL_OBSERVATION_GOVERNANCE_POLICY;

export interface ObservationGovernanceResult {
  observation: string;
  observationTruncation?: ObservationTruncationMeta;
}

export function resolveToolObservationGovernancePolicy(
  policy: AgentSpecToolObservationGovernancePolicy | undefined,
): Required<AgentSpecToolObservationGovernancePolicy> {
  return {
    enabled: policy?.enabled ?? DEFAULT_TOOL_OBSERVATION_GOVERNANCE_POLICY.enabled,
    maxChars: policy?.maxChars ?? DEFAULT_TOOL_OBSERVATION_GOVERNANCE_POLICY.maxChars,
    maxLines: policy?.maxLines ?? DEFAULT_TOOL_OBSERVATION_GOVERNANCE_POLICY.maxLines,
  };
}

function readObservationPreviewMeta(parsed: Record<string, unknown>): ObservationPreviewMeta | undefined {
  const meta = parsed['observationPreviewMeta'];
  if (!isRecord(meta)) {
    return undefined;
  }

  const filename = readString(meta['filename']);
  const docName = readString(meta['doc_name']);
  const documentName = readString(meta['document_name']);
  // 文档类型命名空间属于 host/plugin；runtime 只校验它是非空字符串并原样转交。
  const docType = readString(meta['doc_type']);

  if (!filename && !docName && !documentName && !docType) {
    return undefined;
  }

  return {
    ...(filename ? { filename } : {}),
    ...(docName ? { doc_name: docName } : {}),
    ...(documentName ? { document_name: documentName } : {}),
    ...(docType ? { doc_type: docType } : {}),
  };
}

export async function applyObservationGovernance(params: {
  parsed: unknown;
  toolName: string;
  toolContext: ObservationPreviewContext;
  structuredObservation: string | undefined;
  observationPreview: ObservationPreviewPort;
  policy?: AgentSpecToolObservationGovernancePolicy;
}): Promise<ObservationGovernanceResult> {
  if (!params.structuredObservation || !isRecord(params.parsed)) {
    throw new Error('Observation governance requires a validated structured tool result.');
  }

  const policy = resolveToolObservationGovernancePolicy(params.policy);
  if (!policy.enabled) {
    return { observation: params.structuredObservation };
  }

  const truncated = await params.observationPreview.truncateObservation({
    context: params.toolContext,
    toolName: params.toolName,
    text: params.structuredObservation,
    maxChars: policy.maxChars,
    maxLines: policy.maxLines,
    meta: readObservationPreviewMeta(params.parsed),
  });

  if (!truncated.truncated) {
    return { observation: params.structuredObservation };
  }

  params.parsed['observation'] = truncated.preview;
  return {
    observation: truncated.preview,
    observationTruncation: buildObservationTruncationMeta({
      blobId: truncated.blob_id,
      originalText: params.structuredObservation,
      previewText: truncated.preview,
      originalChars: truncated.originalChars,
      previewChars: truncated.previewChars,
      originalLines: truncated.originalLines,
      previewLines: truncated.previewLines,
    }),
  };
}

function buildObservationTruncationMeta(input: {
  blobId: string;
  originalText: string;
  previewText: string;
  originalChars?: number;
  previewChars?: number;
  originalLines?: number;
  previewLines?: number;
}): ObservationTruncationMeta {
  return {
    blobId: input.blobId,
    originalChars: input.originalChars ?? input.originalText.length,
    previewChars: input.previewChars ?? input.previewText.length,
    originalLines: input.originalLines ?? countLines(input.originalText),
    previewLines: input.previewLines ?? countLines(input.previewText),
  };
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.split(/\r\n|\r|\n/).length;
}
