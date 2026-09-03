import { computed, unref, type ComputedRef, type Ref } from 'vue';
import type {
  ActiveChromeBlock,
  ActiveChromeSourceSnapshot,
} from './definitions/activeChromeBlocks';
import { resolveActiveChromeBlocks } from './functions/resolveActiveChromeBlocks';

type Readable<T> = T | Ref<T> | ComputedRef<T>;
type ReadableBlockId = Readable<string | null | undefined>;
type ReadableBlockIds = Readable<readonly (string | null | undefined)[] | null | undefined>;

export interface UseActiveChromeBlocksOptions {
  hoveredBlockId?: ReadableBlockId;
  selectedBlockId?: ReadableBlockId;
  focusedBlockId?: ReadableBlockId;
  menuOpenBlockId?: ReadableBlockId;
  draggingBlockId?: ReadableBlockId;
  annotationActiveBlockIds?: ReadableBlockIds;
  revisionToolbarBlockIds?: ReadableBlockIds;
  historyModeBlockIds?: ReadableBlockIds;
  keepAlivePinnedBlockIds?: ReadableBlockIds;
}

export interface UseActiveChromeBlocksReturn {
  activeChromeBlocks: ComputedRef<ActiveChromeBlock[]>;
  activeChromeBlockIds: ComputedRef<string[]>;
}

function readBlockId(value: ReadableBlockId | undefined): string | null | undefined {
  return value === undefined ? undefined : unref(value);
}

function readBlockIds(value: ReadableBlockIds | undefined): readonly (string | null | undefined)[] {
  return value === undefined ? [] : unref(value) ?? [];
}

export function useActiveChromeBlocks(
  options: UseActiveChromeBlocksOptions
): UseActiveChromeBlocksReturn {
  const activeChromeBlocks = computed<ActiveChromeBlock[]>(() => {
    const snapshot: ActiveChromeSourceSnapshot = {
      hoveredBlockId: readBlockId(options.hoveredBlockId),
      selectedBlockId: readBlockId(options.selectedBlockId),
      focusedBlockId: readBlockId(options.focusedBlockId),
      menuOpenBlockId: readBlockId(options.menuOpenBlockId),
      draggingBlockId: readBlockId(options.draggingBlockId),
      annotationActiveBlockIds: readBlockIds(options.annotationActiveBlockIds),
      revisionToolbarBlockIds: readBlockIds(options.revisionToolbarBlockIds),
      historyModeBlockIds: readBlockIds(options.historyModeBlockIds),
      keepAlivePinnedBlockIds: readBlockIds(options.keepAlivePinnedBlockIds),
    };
    return resolveActiveChromeBlocks(snapshot);
  });

  const activeChromeBlockIds = computed<string[]>(() => {
    return activeChromeBlocks.value.map((block) => block.blockId);
  });

  return {
    activeChromeBlocks,
    activeChromeBlockIds,
  };
}
