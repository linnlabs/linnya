import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';

/** 每次显式确认单独成组；快速连续修改题注也不能与上一次输入共用撤销步骤。 */
export function commitFigureCaptionAttributes(
  editor: Editor,
  position: number,
  attrs: Readonly<Record<string, unknown>>
): void {
  editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(position, undefined, attrs));
}
