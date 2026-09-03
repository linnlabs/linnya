import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
  ToolTitleDescriptor,
} from '@linnya/plugin-host-contract/renderer/toolUi';

import {
  MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
  type MindmapToolCardMessageKey,
} from '../definitions/mindmapToolCardMessageCatalog';
import type {
  MindmapAttachEvidenceItemPresentation,
  MindmapAttachEvidencePresentationData,
  MindmapCreateNodePresentationData,
  MindmapCreatedNodePresentation,
  MindmapMutationPresentationData,
  MindmapParallelSubrunItemPresentation,
  MindmapParallelSubrunPresentationData,
  MindmapSingleSubrunPresentationData,
  MindmapTagNodeItemPresentation,
  MindmapTagNodePresentationData,
  MindmapTagNodeUpdatePresentation,
  MindmapToolStatus,
} from '../definitions/mindmapToolPresentation';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数字`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} 必须是字符串数组`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireResultData(value: unknown): UnknownRecord {
  const result = requireRecord(value, 'MindMap tool result');
  return requireRecord(result['data'], 'MindMap tool result.data');
}

function readLifecycleDocumentId(value: unknown): string {
  return requireString(requireRecord(value, 'MindMap tool args')['document_id'], 'document_id');
}

function localizedText(key: MindmapToolCardMessageKey, params?: Readonly<Record<string, string>>): {
  readonly key: MindmapToolCardMessageKey;
  readonly fallback: string;
  readonly params?: Readonly<Record<string, string>>;
} {
  return {
    key,
    fallback: MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS[key],
    ...(params ? { params } : {}),
  };
}

function mutationTitle(
  documentName: string | undefined,
  documentId: string,
  tagKey: MindmapToolCardMessageKey,
): ToolTitleDescriptor {
  return {
    text: localizedText('mindmap.tool.title.document', {
      document: documentName ?? documentId,
    }),
    tag: {
      text: localizedText(tagKey),
      variant: 'warning',
    },
  };
}

function projectLifecycle(
  input: ToolPresentationProjectorInput,
  tagKey: MindmapToolCardMessageKey,
): ToolPresentationProjection<MindmapMutationPresentationData> {
  const documentId = readLifecycleDocumentId(input.args);
  return {
    data: { kind: 'lifecycle', documentId },
    title: mutationTitle(undefined, documentId, tagKey),
  };
}

function readTagUpdates(value: unknown, path: string): MindmapTagNodeUpdatePresentation {
  const updates = requireRecord(value, path);
  const confidence = updates['confidence'];
  if (
    confidence !== undefined
    && typeof confidence !== 'string'
    && (typeof confidence !== 'number' || !Number.isFinite(confidence))
  ) {
    throw new Error(`${path}.confidence 必须是字符串或有限数字`);
  }
  return {
    ...(optionalString(updates['status'], `${path}.status`) ? { status: requireString(updates['status'], `${path}.status`) } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(optionalString(updates['kind'], `${path}.kind`) ? { kind: requireString(updates['kind'], `${path}.kind`) } : {}),
  };
}

function readTagItems(value: unknown): readonly MindmapTagNodeItemPresentation[] {
  if (!Array.isArray(value)) throw new Error('MindMap tag result.results 必须是数组');
  return value.map((item, index) => {
    const row = requireRecord(item, `results[${index}]`);
    return {
      nodeId: requireString(row['nodeId'], `results[${index}].nodeId`),
      ...(optionalString(row['nodeRef'], `results[${index}].nodeRef`) ? { nodeRef: requireString(row['nodeRef'], `results[${index}].nodeRef`) } : {}),
      topic: requireString(row['topic'], `results[${index}].topic`),
      updates: readTagUpdates(row['updates'], `results[${index}].updates`),
    };
  });
}

export function projectMindmapTagNodePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapMutationPresentationData> {
  if (input.status !== 'success') {
    return projectLifecycle(input, 'mindmap.tool.tag.update');
  }
  const data = requireResultData(input.result);
  const documentId = requireString(data['documentId'], 'result.data.documentId');
  const documentName = requireString(data['documentName'], 'result.data.documentName');
  const projection: MindmapTagNodePresentationData = {
    kind: 'tag-node',
    documentId,
    items: readTagItems(data['results']),
    warnings: optionalStringArray(data['warnings'], 'result.data.warnings'),
  };
  return {
    data: projection,
    title: mutationTitle(documentName, documentId, 'mindmap.tool.tag.update'),
  };
}

function readAttachItems(value: unknown): readonly MindmapAttachEvidenceItemPresentation[] {
  if (!Array.isArray(value)) throw new Error('MindMap attach result.results 必须是数组');
  return value.map((item, index) => {
    const row = requireRecord(item, `results[${index}]`);
    const status = row['status'];
    if (status !== 'attached' && status !== 'failed') {
      throw new Error(`results[${index}].status 非法`);
    }
    return {
      nodeId: requireString(row['nodeId'], `results[${index}].nodeId`),
      ...(optionalString(row['nodeRef'], `results[${index}].nodeRef`) ? { nodeRef: requireString(row['nodeRef'], `results[${index}].nodeRef`) } : {}),
      ...(optionalString(row['topic'], `results[${index}].topic`) ? { topic: requireString(row['topic'], `results[${index}].topic`) } : {}),
      ...(optionalString(row['evidenceId'], `results[${index}].evidenceId`) ? { evidenceId: requireString(row['evidenceId'], `results[${index}].evidenceId`) } : {}),
      status,
      ...(optionalString(row['message'], `results[${index}].message`) ? { message: requireString(row['message'], `results[${index}].message`) } : {}),
    };
  });
}

export function projectMindmapAttachEvidencePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapMutationPresentationData> {
  if (input.status !== 'success') {
    return projectLifecycle(input, 'mindmap.tool.tag.attachEvidence');
  }
  const data = requireResultData(input.result);
  const documentId = requireString(data['documentId'], 'result.data.documentId');
  const documentName = requireString(data['documentName'], 'result.data.documentName');
  const projection: MindmapAttachEvidencePresentationData = {
    kind: 'attach-evidence',
    documentId,
    items: readAttachItems(data['results']),
    warnings: optionalStringArray(data['warnings'], 'result.data.warnings'),
  };
  return {
    data: projection,
    title: mutationTitle(documentName, documentId, 'mindmap.tool.tag.attachEvidence'),
  };
}

function readCreatedItems(value: unknown): readonly MindmapCreatedNodePresentation[] {
  if (!Array.isArray(value)) throw new Error('MindMap create result.results 必须是数组');
  return value.map((item, index) => {
    const row = requireRecord(item, `results[${index}]`);
    return {
      parentNodeId: requireString(row['parentNodeId'], `results[${index}].parentNodeId`),
      ...(optionalString(row['parentNodeRef'], `results[${index}].parentNodeRef`) ? { parentNodeRef: requireString(row['parentNodeRef'], `results[${index}].parentNodeRef`) } : {}),
      nodeId: requireString(row['nodeId'], `results[${index}].nodeId`),
      ...(optionalString(row['nodeRef'], `results[${index}].nodeRef`) ? { nodeRef: requireString(row['nodeRef'], `results[${index}].nodeRef`) } : {}),
      topic: requireString(row['topic'], `results[${index}].topic`),
    };
  });
}

export function projectMindmapCreateNodePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapMutationPresentationData> {
  if (input.status !== 'success') {
    return projectLifecycle(input, 'mindmap.tool.tag.createNode');
  }
  const data = requireResultData(input.result);
  const documentId = requireString(data['documentId'], 'result.data.documentId');
  const documentName = requireString(data['documentName'], 'result.data.documentName');
  const projection: MindmapCreateNodePresentationData = {
    kind: 'create-node',
    documentId,
    createdCount: requireNumber(data['createdCount'], 'result.data.createdCount'),
    items: readCreatedItems(data['results']),
    warnings: optionalStringArray(data['warnings'], 'result.data.warnings'),
  };
  return {
    data: projection,
    title: mutationTitle(documentName, documentId, 'mindmap.tool.tag.createNode'),
  };
}

function resolveStatus(input: ToolPresentationProjectorInput, success: boolean): MindmapToolStatus {
  if (input.status === 'loading') return 'loading';
  return input.status === 'error' || !success ? 'error' : 'success';
}

function readSingleSubrunArgs(value: unknown): { readonly description: string } {
  const args = requireRecord(value, 'MindMap subrun args');
  return { description: requireString(args['description'], 'description') };
}

function projectSingleSubrunData(
  input: ToolPresentationProjectorInput,
): MindmapSingleSubrunPresentationData {
  const args = readSingleSubrunArgs(input.args);
  if (input.status !== 'success') {
    const subrunId = input.subrunSummary?.subrun_ids[0];
    return {
      description: args.description,
      status: resolveStatus(input, false),
      subagentType: 'mindmap',
      ...(subrunId ? { subrunId } : {}),
    };
  }
  const data = requireResultData(input.result);
  const resultDescription = requireString(data['description'], 'result.data.description');
  if (resultDescription !== args.description) {
    throw new Error('MindMap subrun 的 args/result description 不一致');
  }
  const success = data['success'];
  if (typeof success !== 'boolean') throw new Error('result.data.success 必须是布尔值');
  return {
    description: args.description,
    status: resolveStatus(input, success),
    subrunId: requireString(data['subrun_id'], 'result.data.subrun_id'),
    subagentType: 'mindmap',
  };
}

export function projectMindmapSingleSubrunPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapSingleSubrunPresentationData> {
  return { data: projectSingleSubrunData(input) };
}

interface ParallelSubrunArgs {
  readonly kind: 'decompose' | 'propose' | 'validate';
  readonly description: string;
}

function readParallelArgs(value: unknown): readonly ParallelSubrunArgs[] {
  const args = requireRecord(value, 'MindMap parallel subrun args');
  const rows = args['subruns'];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('MindMap parallel subrun args.subruns 必须是非空数组');
  }
  return rows.map((item, index) => {
    const row = requireRecord(item, `subruns[${index}]`);
    const kind = row['kind'];
    if (kind !== 'decompose' && kind !== 'propose' && kind !== 'validate') {
      throw new Error(`subruns[${index}].kind 非法`);
    }
    return {
      kind,
      description: requireString(row['description'], `subruns[${index}].description`),
    };
  });
}

function childPresentation(
  input: ToolPresentationProjectorInput,
  subrunId: string,
  description: string,
  success: boolean,
): MindmapParallelSubrunItemPresentation {
  const status = resolveStatus(input, success);
  return {
    subrunId,
    presentation: {
      uiKey: input.uiKey,
      status,
      phase: input.phase,
      data: { description, status, subrunId, subagentType: 'mindmap' },
    },
  };
}

export function projectMindmapParallelSubrunPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapParallelSubrunPresentationData> {
  const args = readParallelArgs(input.args);
  let items: readonly MindmapParallelSubrunItemPresentation[];
  if (input.status === 'success') {
    const data = requireResultData(input.result);
    const results = data['results'];
    if (!Array.isArray(results) || results.length !== args.length) {
      throw new Error('MindMap parallel subrun 的 args/result 数量不一致');
    }
    items = results.map((value, index) => {
      const row = requireRecord(value, `result.data.results[${index}]`);
      const expected = args[index];
      if (!expected) throw new Error(`缺少 subruns[${index}]`);
      const kind = requireString(row['kind'], `result.data.results[${index}].kind`);
      const description = requireString(row['description'], `result.data.results[${index}].description`);
      if (kind !== expected.kind || description !== expected.description) {
        throw new Error(`MindMap parallel subrun 第 ${index + 1} 项身份不一致`);
      }
      const success = row['success'];
      if (typeof success !== 'boolean') {
        throw new Error(`result.data.results[${index}].success 必须是布尔值`);
      }
      return childPresentation(
        input,
        requireString(row['subrun_id'], `result.data.results[${index}].subrun_id`),
        description,
        success,
      );
    });
  } else {
    const summaryIds = input.subrunSummary?.subrun_ids ?? [];
    if (summaryIds.length < args.length && !input.toolCallId) {
      throw new Error('MindMap parallel subrun lifecycle 缺少稳定 parent tool_call_id');
    }
    items = args.map((item, index) => childPresentation(
      input,
      summaryIds[index] ?? `${input.toolCallId}_${index}`,
      item.description,
      false,
    ));
  }
  return { data: { kind: 'parallel-subruns', items } };
}
