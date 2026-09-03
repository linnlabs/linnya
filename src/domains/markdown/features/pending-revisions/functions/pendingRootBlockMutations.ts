import type {
  MarkdownDocJson,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';

interface PendingRootBlockPlacement {
  readonly targetBlockId: string;
  readonly metadataJson: string | null;
}

function readRootBlockId(node: ProseMirrorJsonNode): string | null {
  return node.type === 'rootBlock' && typeof node.attrs?.id === 'string'
    ? node.attrs.id
    : null;
}

function isInsertAfterAnchor(metadataJson: string | null, anchorBlockId: string): boolean {
  if (!metadataJson) return false;
  try {
    const metadata: unknown = JSON.parse(metadataJson);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const record = metadata as Record<string, unknown>;
    return record.operation === 'insert' && record.anchorBlockId === anchorBlockId;
  } catch {
    return false;
  }
}

/**
 * 为工具 insert 创建空 rootBlock，并追加到同一锚点既有 insert 占位块之后。
 * 该顺序是 pending 模型的一部分，不能由数组 splice 的偶然行为决定。
 */
export function insertPendingRootBlock(input: {
  readonly documentId: string;
  readonly document: MarkdownDocJson;
  readonly anchorBlockId: string;
  readonly newBlockId: string;
  readonly existingPendings: readonly PendingRootBlockPlacement[];
}): MarkdownDocJson {
  const content = [...input.document.content];
  const anchorIndex = content.findIndex(
    (node) => readRootBlockId(node) === input.anchorBlockId
  );
  if (anchorIndex === -1) {
    throw new Error(
      `[insertEmptyBlockAfter] 找不到锚点块: anchorBlockId=${input.anchorBlockId}, documentId=${input.documentId}`
    );
  }

  const siblingInsertIds = new Set(
    input.existingPendings
      .filter((pending) => isInsertAfterAnchor(pending.metadataJson, input.anchorBlockId))
      .map((pending) => pending.targetBlockId)
  );

  let insertIndex = anchorIndex + 1;
  while (insertIndex < content.length) {
    const blockId = readRootBlockId(content[insertIndex]!);
    if (!blockId || !siblingInsertIds.has(blockId)) break;
    insertIndex += 1;
  }

  content.splice(insertIndex, 0, {
    type: 'rootBlock',
    attrs: { id: input.newBlockId },
    content: [
      {
        type: 'baseBlock',
        attrs: { id: `${input.newBlockId}-inner` },
        content: [],
      },
    ],
  });
  return { ...input.document, content };
}

/** insert 意图被 delete 抵消时，删除此前创建的占位 rootBlock。 */
export function removePendingRootBlock(input: {
  readonly documentId: string;
  readonly document: MarkdownDocJson;
  readonly blockId: string;
}): MarkdownDocJson {
  const position = input.document.content.findIndex(
    (node) => readRootBlockId(node) === input.blockId
  );
  if (position === -1) {
    throw new Error(
      `[removeRootBlockEntity] 找不到要删除的 rootBlock: `
        + `documentId=${input.documentId}, blockId=${input.blockId}`
    );
  }

  const content = [...input.document.content];
  content.splice(position, 1);
  return { ...input.document, content };
}
