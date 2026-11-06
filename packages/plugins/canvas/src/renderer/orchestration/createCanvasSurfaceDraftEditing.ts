import { JsonValueSchema } from '@app/schemas';
import { createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { createCanvasCardMovement } from '../features/elementEditing';
import { createCanvasTextCreation } from '../features/textCreation';

import type { CanvasSurfaceDraftEditingOptions } from './definitions/canvasSurfaceComposition';

/** 正文编辑、创建草稿和位移提交共享同一个保存边界。 */
export function createCanvasSurfaceDraftEditing({
  options,
  ports,
  base,
  rendering,
  readViewport,
}: CanvasSurfaceDraftEditingOptions) {
  const { session, layout, editor, selection, report, dragging } = base;
  const { kernel, navigate } = rendering;
  const editable = ports.createEditor({
    element: options.editorHost,
    content: JsonValueSchema.parse(createCanvasPlainTextDocument('')),
    label: '文字卡正文',
    resolveImageSource: ports.resolveImageSource,
    onError: report,
    onNavigate: navigate,
    onUpdate: content => {
      try {
        if (creation.state.draft.value) creation.update(content);
        else editor.update(content);
        setDirty();
      } catch (failure) {
        report(failure);
      }
    },
    onBlur: () => {
      void save(true).then(setDirty).catch(report);
    },
  });
  const creation = createCanvasTextCreation(
    session,
    async (id, continueEditing, readRemaining, historyGroupId) => {
      selection.select([id]);
      kernel.setSelection([id]);
      if (creation.state.draft.value?.arrangement) readViewport().reveal(id);
      if (continueEditing) {
        await editor.open(id, historyGroupId);
        const remaining = readRemaining();
        if (remaining) {
          editor.update(JsonValueSchema.parse(remaining));
          editor.measure(creation.state.draft.value?.height ?? 64);
        }
      }
    },
    (operations, historyGroupId, arrangement) => {
      if (!arrangement) return session.commit(operations, historyGroupId);
      if (!layout) throw new Error('当前表面未配置自动排布');
      return layout.run(arrangement, operations, historyGroupId);
    }
  );
  const setDirty = () => {
    const draft = editor.state.draft.value;
    ports.markDirty(
      creation.hasContent() || Boolean(draft && draft.editSequence !== draft.savedSequence)
    );
  };
  const save = async (final: boolean) => {
    if (!(await creation.save(final))) return false;
    const saved = await editor.save(final);
    setDirty();
    return saved;
  };
  const movement = createCanvasCardMovement(session, async ids => {
    kernel.clearDragPreview();
    await dragging.set(ids, false);
  });
  const finish = async () => {
    await movement.flush();
    return save(true);
  };
  return { editable, creation, setDirty, save, movement, finish };
}
