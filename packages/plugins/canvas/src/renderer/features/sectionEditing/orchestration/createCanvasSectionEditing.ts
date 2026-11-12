import {
  CANVAS_SECTION_DEFAULT_HEIGHT,
  CANVAS_SECTION_DEFAULT_WIDTH,
  CanvasCardIdSchema,
  canvasSectionContentBounds,
  type CanvasCard,
  type CanvasCardId,
  type CanvasSectionCard,
} from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { createCanvasSectionTitleState } from '../store/createCanvasSectionTitleState';

/** 新建分区、改分区标题；归属与外框由提交规则保证，这里只发出用户意图。 */
export function createCanvasSectionEditing(options: {
  readonly session: CanvasDocumentSession;
  readonly select: (ids: readonly CanvasCardId[]) => Promise<void>;
  readonly readDark: () => boolean;
}) {
  const state = createCanvasSectionTitleState();
  const elements = () => options.session.state.snapshot.value?.elements ?? [];
  const find = (id: CanvasCardId) =>
    elements().find(
      (element): element is CanvasSectionCard => element.id === id && element.type === 'section'
    );
  const begin = (id: CanvasCardId) => {
    const section = find(id);
    if (section && !section.locked) state.begin(id, section.data.title);
  };
  return {
    state,
    begin,
    read: find,
    readDark: options.readDark,
    async save(value = state.draft.value?.value ?? '') {
      const draft = state.draft.value;
      if (!draft) return;
      state.end();
      const section = find(draft.id),
        title = value.trim();
      if (!section || section.data.title === title) return;
      await options.session.commit([
        {
          op: 'update',
          id: section.id,
          baseRevision: section.revision,
          patch: { data: { title } },
        },
      ]);
    },
    cancel: () => state.end(),
    /** 把选中的卡放进一个新分区：分区围着它们建，随后直接进入标题编辑。 */
    async group(ids: readonly CanvasCardId[]) {
      const members = elements().filter(
        (element): element is CanvasCard =>
          element.type !== 'edge' &&
          element.type !== 'section' &&
          !element.locked &&
          ids.includes(element.id)
      );
      if (!members.length) return;
      const frame = canvasSectionContentBounds(members) ?? {
        x: 0,
        y: 0,
        width: CANVAS_SECTION_DEFAULT_WIDTH,
        height: CANVAS_SECTION_DEFAULT_HEIGHT,
      };
      const result = await options.session.commit([
        {
          op: 'addSection',
          ref: '$section',
          title: '',
          ...frame,
          members: members.map(card => card.id),
        },
      ]);
      const id = CanvasCardIdSchema.parse(result.refs.$section);
      await options.select([id]);
      begin(id);
    },
  };
}
export type CanvasSectionEditing = ReturnType<typeof createCanvasSectionEditing>;
