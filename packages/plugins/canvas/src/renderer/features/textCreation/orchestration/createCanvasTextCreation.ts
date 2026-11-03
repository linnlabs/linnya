import { CanvasCardIdSchema, CanvasTextDocumentSchema, canvasAutomaticTextHeight, createCanvasPlainTextDocument, type CanvasCardId, type CanvasEndpoint, type CanvasPoint, type CanvasTextDocument } from '@plugin/canvas/shared';
import type { JsonValue } from '@app/schemas';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { canvasTextCreationRectangle, canvasTextHasContent } from '../functions/canvasTextCreation';
import { createCanvasTextCreationState } from '../store/createCanvasTextCreationState';
export function createCanvasTextCreation(session: CanvasDocumentSession, onCommitted: (id: CanvasCardId, continueEditing: boolean, remaining: () => CanvasTextDocument | null, historyGroupId: string) => Promise<void>) {
  const state = createCanvasTextCreationState();
  let composing = false, pending: Promise<boolean> | null = null;
  return { state,
    begin(point: CanvasPoint, from: CanvasEndpoint | null = null, text = '') { state.begin({ ...canvasTextCreationRectangle(point, from), identity: crypto.randomUUID(), from, anchor: point, content: createCanvasPlainTextDocument(text), editSequence: 0 }); },
    update(content: JsonValue) { state.update(CanvasTextDocumentSchema.parse(content)); },
    setComposing(value: boolean) { composing = value; },
    measure(height: number) { state.measure(canvasAutomaticTextHeight(Math.ceil(height))); },
    hasContent: () => state.draft.value ? canvasTextHasContent(state.draft.value.content) : false,
    async save(final: boolean): Promise<boolean> {
      if (pending) return pending;
      const draft = state.draft.value; if (!draft) return true;
      if (composing) return false;
      if (!canvasTextHasContent(draft.content)) { if (final) state.clear(); return true; }
      state.beginSave();
      pending = (async () => {
        try {
          const result = await session.commit([{ op: 'addText', ref: '$created', x: draft.x, y: draft.y, width: draft.width, height: draft.height, content: draft.content },
            ...(draft.from ? [{ op: 'connect' as const, from: draft.from, to: '$created', direction: 'forward' as const, label: '', lineStyle: 'curve' as const, linePattern: 'solid' as const }] : [])], draft.identity);
          const id = CanvasCardIdSchema.parse(result.refs.$created);
          const remaining = () => { const latest = state.draft.value; return latest && (latest.editSequence !== draft.editSequence || latest.height !== draft.height) ? latest.content : null; };
          // 先建立真实编辑会话再清临时草稿，避免短暂隐藏唯一DOM造成blur及丢失在途插图锚点。
          await onCommitted(id, !final || remaining() !== null, remaining, draft.identity); state.clear(); return true;
        } catch (failure) { state.fail(failure instanceof Error ? failure.message : String(failure)); return false; }
      })();
      try { return await pending; } finally { pending = null; }
    },
    cancel() { state.clear(); },
  };
}
