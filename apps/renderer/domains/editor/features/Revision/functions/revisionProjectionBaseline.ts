import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { rebaseEditorNode } from '../../../functions/rebaseEditorDocument';

import type { RevisionProjectionEntry } from '../definitions/revision';

/** 纯粹移除行内视图标记；结构变换的原始形态由投影账本恢复。 */
export function stripRevisionProjection(node: ProseMirrorNode, mode: 'baseline' | 'preview'): ProseMirrorNode | null {
  const revision = node.marks.find(mark => mark.type.name === 'revisionMark');
  if (revision?.attrs.changeType === (mode === 'baseline' ? 'insert' : 'delete')) return null;
  const children: ProseMirrorNode[] = [];
  node.forEach(child => {
    const clean = stripRevisionProjection(child, mode);
    if (clean) children.push(clean);
  });
  return (node.isLeaf ? node : node.copy(Fragment.from(children)))
    .mark(node.marks.filter(mark => mark.type.name !== 'revisionMark'));
}

export function readRevisionBaseline(
  document: ProseMirrorNode,
  projections: ReadonlyMap<string, RevisionProjectionEntry>,
  projectionOnlyRoots: ReadonlyMap<string, ProseMirrorNode>,
): ProseMirrorNode {
  const blocks: ProseMirrorNode[] = [];
  document.forEach(root => {
    const id: unknown = root.attrs.id;
    const history = typeof id === 'string' ? projectionOnlyRoots.get(id) : undefined;
    if (history) {
      if (!root.eq(history)) throw new Error('修订历史投影已被编辑，请先处理该修订。');
      return;
    }
    const entry = typeof id === 'string' ? projections.get(id) : undefined;
    if (!entry) { blocks.push(root); return; }
    if (root.eq(entry.projected)) { blocks.push(entry.baseline); return; }
    const projected = stripRevisionProjection(entry.projected, 'baseline');
    const local = stripRevisionProjection(root, 'baseline');
    if (!projected || !local) throw new Error('修订根块不可作为行内插入或删除');
    // 表格/块类型转换不能靠删 mark 还原；从投影前后差异中只提取用户后来做的编辑。
    blocks.push(rebaseEditorNode(projected, local, entry.baseline));
  });
  return document.copy(Fragment.from(blocks));
}
