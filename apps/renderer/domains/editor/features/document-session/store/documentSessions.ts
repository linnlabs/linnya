import type { Editor } from '@tiptap/core';
import type { MarkdownDocumentSession } from '../definitions/documentSession';
import type { MarkdownRevisionSnapshot } from '@app/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const sessions = new WeakMap<Editor, MarkdownDocumentSession>();
export const getDocumentSession = (editor: Editor) => sessions.get(editor);
export function bindDocumentSession(editor: Editor, session: MarkdownDocumentSession): void { sessions.set(editor, session); }
export function unbindDocumentSession(editor: Editor, documentId: string): void {
  if (sessions.get(editor)?.documentId === documentId) sessions.delete(editor);
}
export function setDocumentSnapshot(session: MarkdownDocumentSession, snapshot: MarkdownRevisionSnapshot, baseline: ProseMirrorNode): void {
  session.snapshot = snapshot;
  session.baseline = baseline;
}
