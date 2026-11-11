import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
export interface FoundEditorNode { node: ProseMirrorNode; pos: number; }
export interface FoundEditorBlock extends FoundEditorNode { start: number; end: number; depth: number; }
/** 对应 NodeFinder.js 的实际返回形状；节点与位置不经类型断言转换。 */
export class NodeFinder {
  constructor(editor: Editor | null);
  findAllNodesOfType(type: string): FoundEditorNode[];
  findNodesInSelection(predicate: (node: ProseMirrorNode) => boolean): FoundEditorNode[];
  getTextInSelection(): string;
  findBlockAt(pos: number): FoundEditorBlock | null;
  findChildIndexAt(pos: number): number | null;
  getChildNodeAt(parentPos: number, index: number): FoundEditorNode | null;
  findNodeById(id: string): FoundEditorNode | null;
  findNodeAt(pos: number): FoundEditorNode | null;
}
