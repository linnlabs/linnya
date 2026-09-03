export interface RootBlockDragStateSnapshot {
  draggingRootBlockId: string | null;
  draggingRootBlockInfo: RootBlockDragInfo | null;
}

export interface RootBlockDragInfo {
  id: string;
  type: string | null;
  pos: number | null;
}

export type RootBlockDragStateListener = (snapshot: RootBlockDragStateSnapshot) => void;

let draggingRootBlockId: string | null = null;
let draggingRootBlockInfo: RootBlockDragInfo | null = null;
const listeners = new Set<RootBlockDragStateListener>();

function normalizeRootBlockId(blockId: unknown): string | null {
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null;
}

function getSnapshot(): RootBlockDragStateSnapshot {
  return {
    draggingRootBlockId,
    draggingRootBlockInfo,
  };
}

function notifyListeners(): void {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => {
    listener(snapshot);
  });
}

function setDraggingRootBlockInfo(nextInfo: RootBlockDragInfo | null): void {
  if (
    draggingRootBlockInfo?.id === nextInfo?.id
    && draggingRootBlockInfo?.type === nextInfo?.type
    && draggingRootBlockInfo?.pos === nextInfo?.pos
  ) {
    return;
  }
  draggingRootBlockInfo = nextInfo;
  draggingRootBlockId = nextInfo?.id ?? null;
  notifyListeners();
}

export function getRootBlockDragStateSnapshot(): RootBlockDragStateSnapshot {
  return getSnapshot();
}

export function subscribeRootBlockDragState(
  listener: RootBlockDragStateListener,
  options: { replayCurrent?: boolean } = {}
): () => void {
  listeners.add(listener);
  if (options.replayCurrent) {
    listener(getSnapshot());
  }
  return () => {
    listeners.delete(listener);
  };
}

export function publishRootBlockDragStart(
  blockId: unknown,
  details: { type?: unknown; pos?: unknown } = {}
): void {
  const nextBlockId = normalizeRootBlockId(blockId);
  if (!nextBlockId) return;
  setDraggingRootBlockInfo({
    id: nextBlockId,
    type: typeof details.type === 'string' && details.type.length > 0 ? details.type : null,
    pos: typeof details.pos === 'number' && Number.isFinite(details.pos) ? details.pos : null,
  });
}

export function publishRootBlockDragEnd(blockId?: unknown): void {
  const endedBlockId = normalizeRootBlockId(blockId);
  if (endedBlockId && draggingRootBlockId && endedBlockId !== draggingRootBlockId) return;
  setDraggingRootBlockInfo(null);
}
