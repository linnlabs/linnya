import {
  ACTIVE_CHROME_SOURCE_ORDER,
  type ActiveChromeBlock,
  type ActiveChromeSource,
  type ActiveChromeSourceSnapshot,
} from '../definitions/activeChromeBlocks';

type ScalarSourceKey =
  | 'hoveredBlockId'
  | 'selectedBlockId'
  | 'focusedBlockId'
  | 'menuOpenBlockId'
  | 'draggingBlockId';

type ListSourceKey =
  | 'annotationActiveBlockIds'
  | 'revisionToolbarBlockIds'
  | 'historyModeBlockIds'
  | 'keepAlivePinnedBlockIds';

const scalarSourceByKey: Readonly<Record<ScalarSourceKey, ActiveChromeSource>> = {
  hoveredBlockId: 'hovered',
  selectedBlockId: 'selected',
  focusedBlockId: 'focused',
  menuOpenBlockId: 'menu-open',
  draggingBlockId: 'dragging',
};

const listSourceByKey: Readonly<Record<ListSourceKey, ActiveChromeSource>> = {
  annotationActiveBlockIds: 'annotation',
  revisionToolbarBlockIds: 'revision-toolbar',
  historyModeBlockIds: 'history-mode',
  keepAlivePinnedBlockIds: 'keep-alive',
};

const scalarKeysBySourceOrder: readonly ScalarSourceKey[] = [
  'hoveredBlockId',
  'selectedBlockId',
  'focusedBlockId',
  'menuOpenBlockId',
  'draggingBlockId',
];

const listKeysBySourceOrder: readonly ListSourceKey[] = [
  'annotationActiveBlockIds',
  'revisionToolbarBlockIds',
  'historyModeBlockIds',
  'keepAlivePinnedBlockIds',
];

function normalizeBlockId(blockId: string | null | undefined): string | null {
  const normalized = blockId?.trim();
  return normalized ? normalized : null;
}

function appendSource(
  blocksById: Map<string, ActiveChromeBlock>,
  blockId: string | null | undefined,
  source: ActiveChromeSource
): void {
  const normalizedBlockId = normalizeBlockId(blockId);
  if (!normalizedBlockId) return;

  const existing = blocksById.get(normalizedBlockId);
  if (existing) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
    return;
  }

  blocksById.set(normalizedBlockId, {
    blockId: normalizedBlockId,
    sources: [source],
  });
}

/**
 * 将分散的 chrome 激活来源收束成稳定、去重、有原因标记的 block 列表。
 *
 * 中文说明：
 * - 输出顺序由来源优先级决定，保证 Host mount/unmount 可预测；
 * - 同一个 block 可同时拥有多个来源，但只输出一条记录；
 * - 这里不读取 DOM、不读取 editor state，是 Stage 3 Host 前的纯模型。
 */
export function resolveActiveChromeBlocks(
  snapshot: ActiveChromeSourceSnapshot
): ActiveChromeBlock[] {
  const blocksById = new Map<string, ActiveChromeBlock>();

  ACTIVE_CHROME_SOURCE_ORDER.forEach((source) => {
    scalarKeysBySourceOrder.forEach((key) => {
      if (scalarSourceByKey[key] !== source) return;
      appendSource(blocksById, snapshot[key], source);
    });

    listKeysBySourceOrder.forEach((key) => {
      if (listSourceByKey[key] !== source) return;
      snapshot[key]?.forEach((blockId) => {
        appendSource(blocksById, blockId, source);
      });
    });
  });

  return [...blocksById.values()];
}
