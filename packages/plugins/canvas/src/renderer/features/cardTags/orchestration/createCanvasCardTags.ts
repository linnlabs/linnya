import { watch } from 'vue';
import {
  listCanvasTagIds,
  type CanvasCard,
  type CanvasCardId,
  type CanvasTagNames,
  type CanvasTagsResult,
} from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { createCanvasTagState } from '../store/createCanvasTagState';
import {
  buildCanvasStatusCommands,
  buildCanvasTagToggleCommands,
} from '../functions/buildCanvasTagCommands';
import { canvasTagMenuGroups, type CanvasTagMenuChoice } from '../functions/canvasTagMenu';

/**
 * 卡片标签：卡片里只存工作区标签 ID，名称每次向 Host 读；卡上出现新 ID 或打开菜单时重读。
 * 写入走正式用户提交，进入撤销。
 */
export function createCanvasCardTags(options: {
  readonly session: CanvasDocumentSession;
  readonly read?: (ids: readonly string[]) => Promise<CanvasTagsResult>;
  readonly selection: () => readonly CanvasCardId[];
  readonly installed: (names: CanvasTagNames) => void;
  /** 右键菜单打开时重读工作区标签，别处新建或改名的标签能马上出现。 */
  readonly menuOpened: () => boolean;
  readonly report: (failure: unknown) => void;
}) {
  const state = createCanvasTagState();
  let requested: string | null = null,
    generation = 0;
  const elements = () => options.session.state.snapshot.value?.elements ?? [];
  async function refresh(force = false) {
    if (!options.read) return;
    const ids = listCanvasTagIds(elements());
    const key = [...ids].sort().join('\n');
    if (!force && key === requested) return;
    requested = key;
    const current = ++generation;
    const result = await options.read(ids);
    if (current !== generation) return;
    state.install(result);
    options.installed(state.names.value);
  }
  const stop = watch(
    () => options.session.state.snapshot.value,
    () => void refresh().catch(options.report),
    { immediate: true }
  );
  const stopMenu = watch(options.menuOpened, open => {
    if (open) void refresh(true).catch(options.report);
  });
  async function commit(commands: ReturnType<typeof buildCanvasStatusCommands>) {
    if (commands.length) await options.session.commit(commands);
  }
  return {
    state,
    refresh,
    menu(cards: readonly CanvasCard[]) {
      return canvasTagMenuGroups({ catalog: state.catalog.value, cards, names: state.names.value });
    },
    async choose(choice: CanvasTagMenuChoice) {
      const input = { elements: elements(), ids: options.selection(), names: state.names.value };
      await commit(
        choice.kind === 'tag'
          ? buildCanvasTagToggleCommands({ ...input, tagId: choice.id })
          : buildCanvasStatusCommands({ ...input, tagId: choice.id })
      );
    },
    dispose() {
      generation++;
      stop();
      stopMenu();
    },
  };
}
export type CanvasCardTags = ReturnType<typeof createCanvasCardTags>;
