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
  MarkdownRootBlockJson,
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

/** 只有空文本占位块属于尚未落入正文的 insert；表格、图片等结构本身也是正文。 */
export function isEmptyPendingPlaceholder(root: ProseMirrorJsonNode | undefined): boolean {
  const inner = root?.content?.[0];
  return inner?.type === 'baseBlock' && (inner.content?.length ?? 0) === 0;
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
}): MarkdownDocJson {
  const slots: RootBlockSlot[] = [...input.docJson.content];
  const rootIndex = buildRootBlockIndex(input.docJson.content);

  for (const pending of input.pendings) {
    const operation = resolvePendingOperation(pending, parsePendingMetadata(pending.meta_json));
    const position = rootIndex.get(pending.target_block_id);
    const root = position === undefined ? undefined : slots[position];
    if (position === undefined || !root) {
      throw new Error(`[PendingRevisionApplyService] 接受修订的目标 rootBlock 不存在: blockId=${pending.target_block_id}`);
    }

    if (operation === 'delete') {
      slots[position] = null;
      continue;
    }

    const replacement = input.prepared.get(pending.id);
    if (!replacement) {
      throw new Error(`[PendingRevisionApplyService] 缺少预解析结果: blockId=${pending.target_block_id}`);
    }
    slots[position] = mergeRootBlockAttrs(
      root,
      replacement.rootBlock,
      pending.target_block_id
    );
  }

  return withoutRemovedSlots(input.docJson, slots);
}

export function applyRejectedPendingsToDocument(input: {
  readonly docJson: MarkdownDocJson;
  readonly pendings: readonly PendingRevision[];
}): MarkdownDocJson {
  const slots: RootBlockSlot[] = [...input.docJson.content];
  const rootIndex = buildRootBlockIndex(input.docJson.content);

  for (const pending of input.pendings) {
    const operation = resolvePendingOperation(pending, parsePendingMetadata(pending.meta_json));
    if (operation !== 'insert') {
      continue;
    }

    const position = rootIndex.get(pending.target_block_id);
    // 用户草稿已删除插入占位块时，拒绝只需让提交事务清理对应 Pending。
    if (position === undefined) continue;

    if (isEmptyPendingPlaceholder(slots[position] ?? undefined)) {
      slots[position] = null;
    }
  }

  return withoutRemovedSlots(input.docJson, slots);
}
