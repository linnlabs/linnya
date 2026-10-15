import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// 处理器只读取剪贴板格式与内容；不要求测试提供未使用的原生 DataTransfer 能力。
interface PlainTextPasteEvent extends Pick<Event, 'preventDefault'> {
  readonly clipboardData: Pick<DataTransfer, 'types' | 'getData'> | null;
}

export const plainTextMarkdownHandler: {
  name: string;
  priority: number;
  canHandle(event: PlainTextPasteEvent, context: Pick<EditorState, 'selection'>): boolean;
  handle(event: PlainTextPasteEvent, context: { view: EditorView; editor: Editor }): Promise<boolean>;
};

export default plainTextMarkdownHandler;
