import type {
  MarkdownDocJson,
  ProseMirrorJsonNode,
} from '../../normalization/runtime';

function readRootBlockId(node: ProseMirrorJsonNode): string | null {
  return node.type === 'rootBlock' && typeof node.attrs?.id === 'string'
    ? node.attrs.id
    : null;
}

/** 按写入计划的前驱创建占位块；null 表示文首。块顺序由计划唯一决定。 */
export function insertPendingRootBlock(input: {
  readonly documentId: string;
  readonly document: MarkdownDocJson;
  readonly anchorBlockId: string | null;
  readonly newBlockId: string;
}): MarkdownDocJson {
  const content = [...input.document.content];
  const anchorIndex = input.anchorBlockId === null ? -1 : content.findIndex(
    (node) => readRootBlockId(node) === input.anchorBlockId
  );
  if (input.anchorBlockId !== null && anchorIndex === -1) {
    throw new Error(
      `[insertEmptyBlockAfter] 找不到锚点块: anchorBlockId=${input.anchorBlockId}, documentId=${input.documentId}`
    );
  }

  // 写入计划已按目标顺序传入前驱；null 明确表示文首，不能再越过旧的 insert 占位块。
  content.splice(anchorIndex + 1, 0, {
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
