import {
  CanvasCardIdSchema,
  CanvasTextDocumentSchema,
  canvasAutomaticTextHeight,
  createCanvasPlainTextDocument,
  type CanvasCardId,
  type CanvasEndpoint,
  type CanvasPoint,
  type CanvasTextDocument,
} from '@plugin/canvas/shared';
import type { JsonValue } from '@app/schemas';
import { CanvasCommitOutcomeError, type CanvasDocumentSession } from '../../canvasDocument';
import {
  buildCanvasTextCreationCommands,
  canvasTextCreationRectangle,
  canvasTextHasContent,
} from '../functions/canvasTextCreation';
import { createCanvasTextCreationState } from '../store/createCanvasTextCreationState';
import type {
  CanvasTextCreationCommit,
  CanvasTextCreationDraft,
} from '../definitions/canvasTextCreation';
export function createCanvasTextCreation(
  session: CanvasDocumentSession,
  onCommitted: (
    id: CanvasCardId,
    continueEditing: boolean,
    remaining: () => CanvasTextDocument | null,
    historyGroupId: string
  ) => Promise<void>,
  commit: CanvasTextCreationCommit = (operations, historyGroupId) =>
    session.commit(operations, historyGroupId)
) {
  const state = createCanvasTextCreationState();
  let composing = false,
    pending: Promise<boolean> | null = null;
  const adopt = async (draft: CanvasTextCreationDraft, id: CanvasCardId, final: boolean) => {
    if (state.draft.value?.identity !== draft.identity) return;
    const remaining = () => {
      const latest = state.draft.value;
      return latest &&
        (latest.editSequence !== draft.editSequence || latest.height !== draft.height)
        ? latest.content
        : null;
    };
    // 先建立真实编辑会话再清临时草稿，保持唯一DOM与异步插图锚点。
    await onCommitted(id, !final || remaining() !== null, remaining, draft.identity);
    state.clear();
  };
  return {
    state,
    begin(
      point: CanvasPoint,
      from: CanvasEndpoint | null = null,
      text = '',
      arrangement: CanvasTextCreationDraft['arrangement'] = null
    ) {
      const draft = {
        ...canvasTextCreationRectangle(point, from),
        identity: crypto.randomUUID(),
        from,
        anchor: point,
        arrangement,
        content: createCanvasPlainTextDocument(text),
        editSequence: 0,
      };
      state.begin(draft);
      return draft;
    },
    update(content: JsonValue) {
      state.update(CanvasTextDocumentSchema.parse(content));
    },
    setComposing(value: boolean) {
      composing = value;
    },
    measure(height: number) {
      const draft = state.draft.value;
      if (draft)
        state.resize(
          canvasTextCreationRectangle(
            draft.anchor,
            draft.from,
            canvasAutomaticTextHeight(Math.round(height * 1000) / 1000)
          )
        );
    },
    hasContent: () => (state.draft.value ? canvasTextHasContent(state.draft.value.content) : false),
    async save(final: boolean): Promise<boolean> {
      if (pending) return pending;
      const draft = state.draft.value;
      if (!draft) return true;
      if (composing) return false;
      if (!canvasTextHasContent(draft.content)) {
        if (final) state.clear();
        return true;
      }
      state.beginSave();
      pending = (async () => {
        try {
          const result = await commit(
            buildCanvasTextCreationCommands(draft),
            draft.identity,
            draft.arrangement
          );
          const id = CanvasCardIdSchema.parse(result.refs.$created);
          await adopt(draft, id, final);
          return true;
        } catch (failure) {
          if (failure instanceof CanvasCommitOutcomeError && failure.result.refs.$created) {
            // 起点被并发删除时可能只有连线跳过；已创建正文仍须接纳，不能重试再建一张。
            await adopt(draft, CanvasCardIdSchema.parse(failure.result.refs.$created), final);
            state.fail(failure.message);
            return true;
          }
          state.fail(failure instanceof Error ? failure.message : String(failure));
          return false;
        }
      })();
      try {
        return await pending;
      } finally {
        pending = null;
      }
    },
    cancel() {
      state.clear();
    },
  };
}
