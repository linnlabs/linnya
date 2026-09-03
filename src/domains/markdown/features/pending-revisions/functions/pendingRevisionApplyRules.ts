import type {
  MarkdownDocJson,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';
import type {
  PendingRevision,
  PendingRevisionMetadata,
  PendingRevisionOperation,
} from '../persistence';
import type {
  ApplyMode,
  MarkdownRootBlockJson,
  PendingDocumentApplyResult,
  PendingSnapshotItem,
  PreparedPendingReplacement,
} from '../definitions/pendingRevisionApply';

type RootBlockSlot = MarkdownRootBlockJson | ProseMirrorJsonNode | null;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMarkdownDocJson(value: unknown): value is MarkdownDocJson {
  return isRecord(value) && value.type === 'doc' && Array.isArray(value.content);
}

export function isRootBlock(value: unknown): value is MarkdownRootBlockJson {
  return isRecord(value)
    && value.type === 'rootBlock'
    && isRecord(value.attrs)
    && typeof value.attrs.id === 'string'
    && value.attrs.id.length > 0;
}

export function parsePendingMetadata(metaJson: string | null): PendingRevisionMetadata | null {
  if (!metaJson) return null;
  try {
    const parsed: unknown = JSON.parse(metaJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function resolvePendingOperation(
  revision: PendingRevision,
  metadata: PendingRevisionMetadata | null
): PendingRevisionOperation {
  if (revision.operation === 'insert' || revision.operation === 'update' || revision.operation === 'delete') {
    return revision.operation;
  }
  const operation = metadata?.operation;
  return operation === 'insert' || operation === 'update' || operation === 'delete'
    ? operation
    : 'update';
}

export function snapshotPendings(pendings: readonly PendingRevision[]): PendingSnapshotItem[] {
  return pendings.map((revision) => ({
    id: revision.id,
    target_block_id: revision.target_block_id,
    new_markdown: revision.new_markdown,
    source: revision.source,
    operation: revision.operation,
    meta_json: revision.meta_json,
    created_at: revision.created_at,
    updated_at: revision.updated_at,
  }));
}

export function mergeRootBlockAttrs(
  oldRoot: ProseMirrorJsonNode,
  newRoot: MarkdownRootBlockJson,
  preserveId: string
): MarkdownRootBlockJson {
  const oldAttrs = isRecord(oldRoot.attrs) ? oldRoot.attrs : {};
  const newAttrs = isRecord(newRoot.attrs) ? newRoot.attrs : {};
  return {
    ...newRoot,
    attrs: { ...oldAttrs, ...newAttrs, id: preserveId },
  };
}

export function buildRootBlockIndex(content: readonly ProseMirrorJsonNode[]): Map<string, number> {
  const index = new Map<string, number>();
  content.forEach((node, position) => {
    if (isRootBlock(node)) {
      index.set(String(node.attrs.id), position);
    }
  });
  return index;
}

function withoutRemovedSlots(docJson: MarkdownDocJson, slots: RootBlockSlot[]): MarkdownDocJson {
  return {
    ...docJson,
    content: slots.filter((node): node is ProseMirrorJsonNode => node !== null),
  };
}

export function applyAcceptedPendingsToDocument(input: {
  readonly docJson: MarkdownDocJson;
  readonly pendings: readonly PendingRevision[];
  readonly prepared: ReadonlyMap<string, PreparedPendingReplacement>;
}): PendingDocumentApplyResult {
  const slots: RootBlockSlot[] = [...input.docJson.content];
  const rootIndex = buildRootBlockIndex(input.docJson.content);
  const errors: PendingDocumentApplyResult['errors'] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const pending of input.pendings) {
    const operation = resolvePendingOperation(pending, parsePendingMetadata(pending.meta_json));
    const position = rootIndex.get(pending.target_block_id);
    if (position === undefined || slots[position] === null) {
      skippedCount += 1;
      errors.push({ blockId: pending.target_block_id, reason: '目标 rootBlock 不存在，已跳过' });
      continue;
    }

    if (operation === 'delete') {
      slots[position] = null;
      appliedCount += 1;
      continue;
    }

    const replacement = input.prepared.get(pending.id);
    if (!replacement) {
      throw new Error(`[PendingRevisionApplyService] 缺少预解析结果: blockId=${pending.target_block_id}`);
    }
    slots[position] = mergeRootBlockAttrs(
      slots[position]!,
      replacement.rootBlock,
      pending.target_block_id
    );
    appliedCount += 1;
  }

  return {
    changed: appliedCount > 0,
    docJson: withoutRemovedSlots(input.docJson, slots),
    appliedCount,
    skippedCount,
    errors,
  };
}

export function applyRejectedPendingsToDocument(input: {
  readonly docJson: MarkdownDocJson;
  readonly pendings: readonly PendingRevision[];
}): PendingDocumentApplyResult {
  const slots: RootBlockSlot[] = [...input.docJson.content];
  const rootIndex = buildRootBlockIndex(input.docJson.content);
  const errors: PendingDocumentApplyResult['errors'] = [];
  let appliedCount = 0;
  let skippedCount = 0;
  let changed = false;

  for (const pending of input.pendings) {
    const operation = resolvePendingOperation(pending, parsePendingMetadata(pending.meta_json));
    if (operation !== 'insert') {
      appliedCount += 1;
      continue;
    }

    const position = rootIndex.get(pending.target_block_id);
    if (position === undefined || slots[position] === null) {
      skippedCount += 1;
      errors.push({ blockId: pending.target_block_id, reason: 'insert 占位 rootBlock 不存在，已跳过' });
      continue;
    }

    slots[position] = null;
    appliedCount += 1;
    changed = true;
  }

  return {
    changed,
    docJson: withoutRemovedSlots(input.docJson, slots),
    appliedCount,
    skippedCount,
    errors,
  };
}

export function applySinglePendingToDocument(input: {
  readonly docJson: MarkdownDocJson;
  readonly pending: PendingRevision;
  readonly mode: ApplyMode;
  readonly prepared: MarkdownRootBlockJson | null;
}): PendingDocumentApplyResult {
  const operation = resolvePendingOperation(
    input.pending,
    parsePendingMetadata(input.pending.meta_json)
  );
  const position = buildRootBlockIndex(input.docJson.content).get(input.pending.target_block_id);
  if (position === undefined) {
    return {
      changed: false,
      docJson: input.docJson,
      appliedCount: 0,
      skippedCount: 1,
      errors: [{ blockId: input.pending.target_block_id, reason: '目标 rootBlock 不存在，已跳过' }],
    };
  }

  const slots: RootBlockSlot[] = [...input.docJson.content];
  if (input.mode === 'reject' && operation !== 'insert') {
    return {
      changed: false,
      docJson: input.docJson,
      appliedCount: 1,
      skippedCount: 0,
      errors: [],
    };
  }

  if ((input.mode === 'reject' && operation === 'insert')
    || (input.mode === 'accept' && operation === 'delete')) {
    slots[position] = null;
    return {
      changed: true,
      docJson: withoutRemovedSlots(input.docJson, slots),
      appliedCount: 1,
      skippedCount: 0,
      errors: [],
    };
  }

  if (!input.prepared) {
    throw new Error(
      `[PendingRevisionApplyService] 缺少单块预解析结果: blockId=${input.pending.target_block_id}`
    );
  }
  const existingRoot = slots[position];
  if (!existingRoot) {
    throw new Error(
      `[PendingRevisionApplyService] root block index is inconsistent: blockId=${input.pending.target_block_id}`
    );
  }
  slots[position] = mergeRootBlockAttrs(existingRoot, input.prepared, input.pending.target_block_id);
  return {
    changed: true,
    docJson: withoutRemovedSlots(input.docJson, slots),
    appliedCount: 1,
    skippedCount: 0,
    errors: [],
  };
}
