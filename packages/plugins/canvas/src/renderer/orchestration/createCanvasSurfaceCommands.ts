import { type CanvasColor } from '@plugin/canvas/shared';
import {
  createCanvasKeyboardHandler,
  createCanvasKeyboardNavigation,
} from '../features/accessibility';
import { buildColorCommands, buildDeleteCommands } from '../features/elementEditing';
import { createCanvasDraftDiscard } from './createCanvasDraftDiscard';

import type { CanvasSurfaceCommandsOptions } from './definitions/canvasSurfaceComposition';

/** 用户命令把保存、文档变更和焦点导航串在一起，计算规则留在 feature。 */
export function createCanvasSurfaceCommands({
  base,
  rendering,
  drafts,
  selection: commands,
  bindings,
  viewport,
}: CanvasSurfaceCommandsOptions) {
  const { session, layout, editor, selection, state, cards, report } = base;
  const { camera } = state;
  const { kernel } = rendering;
  const { creation, finish, movement } = drafts;
  const { connections, actions, opening, select, createTree } = commands;
  const { draftParticipants, changedDraft } = bindings;
  const { fit, zoom } = viewport;
  const discardDraft = createCanvasDraftDiscard({
    participants: draftParticipants,
    saving: () =>
      Boolean(
        editor.state.saving.value || creation.state.saving.value || session.mutationPending.value
      ),
    changed: changedDraft,
    focus: viewport.focus,
  });
  async function color(value: CanvasColor) {
    const commands = buildColorCommands(
      session.state.snapshot.value?.elements ?? [],
      selection.ids.value,
      value
    );
    if (commands.length) await session.commit(commands);
  }
  async function remove() {
    if (connections.selected.value) {
      await connections.remove();
      return;
    }
    if (!(await finish())) return;
    const commands = buildDeleteCommands(
      session.state.snapshot.value?.elements ?? [],
      selection.ids.value
    );
    if (commands.length) await session.commit(commands);
    await select([]);
  }
  async function undo(direction: 'undo' | 'redo') {
    await layout?.flush();
    if (await finish()) await session.undo(direction);
  }
  const edit = async () => {
    if (connections.selected.value) {
      await connections.beginLabel();
      return;
    }
    const id = selection.ids.value[0];
    if (id) await opening.open(id);
  };
  const keydown = createCanvasKeyboardHandler({
    isEditing: () =>
      Boolean(
        editor.state.draft.value || creation.state.draft.value || connections.state.label.value
      ),
    selection: () => selection.ids.value,
    allIds: () => cards().map(card => card.id),
    treeMode: () => Boolean(layout?.state.treeKeyboard.value && selection.ids.value.length === 1),
    createTree,
    zoomValue: () => camera.value.zoom,
    duplicate: () => actions.duplicate(),
    undo,
    remove,
    edit,
    select,
    fit,
    zoom,
    move: movement.move,
    navigation: createCanvasKeyboardNavigation({
      cards,
      selection: () => selection.ids.value,
      select,
      reveal: viewport.reveal,
    }),
    escape: async () => {
      const wasEditing = Boolean(editor.state.draft.value || creation.state.draft.value);
      if (await finish()) {
        if (!wasEditing) await select([]);
        kernel.canvas.focus();
      }
    },
  });
  return {
    discardDraft,
    color,
    remove,
    undo,
    edit,
    keydown: (event: KeyboardEvent) => {
      state.clearFailure();
      void keydown(event).catch(report);
    },
  };
}
