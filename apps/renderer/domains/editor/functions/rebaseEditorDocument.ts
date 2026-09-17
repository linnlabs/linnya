import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';

/** 同一值只能由一方改动；两方改成相同值也可合并。冲突必须保留本地草稿并显式报错。 */
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (same(local, base) || same(local, remote)) return remote;
  if (same(remote, base)) return local;
  throw new Error('本地编辑与远端修改重叠，已保留本地内容，请先处理冲突。');
}

export function rebaseEditorNode(base: ProseMirrorNode, local: ProseMirrorNode, remote: ProseMirrorNode): ProseMirrorNode {
  if (local.eq(base) || local.eq(remote)) return remote;
  if (remote.eq(base)) return local;
  if (base.type !== local.type || base.type !== remote.type || base.isText ||
      base.childCount !== local.childCount || base.childCount !== remote.childCount) {
    throw new Error('本地编辑与远端修改重叠，已保留本地内容，请先处理冲突。');
  }
  const attrs: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base.attrs), ...Object.keys(local.attrs), ...Object.keys(remote.attrs)])) {
    attrs[key] = mergeValue(base.attrs[key], local.attrs[key], remote.attrs[key]);
  }
  const children: ProseMirrorNode[] = [];
  for (let index = 0; index < base.childCount; index++) {
    children.push(rebaseEditorNode(base.child(index), local.child(index), remote.child(index)));
  }
  const marks = JSON.stringify(local.marks) === JSON.stringify(base.marks) ? remote.marks : local.marks;
  mergeValue(base.marks, local.marks, remote.marks);
  return remote.type.create(attrs, children, marks);
}

function roots(doc: ProseMirrorNode): Map<string, ProseMirrorNode> {
  const result = new Map<string, ProseMirrorNode>();
  doc.forEach(node => {
    const id: unknown = node.attrs.id;
    if (typeof id !== 'string' || !id || result.has(id)) throw new Error('文档块身份缺失或重复');
    result.set(id, node);
  });
  return result;
}

/** 按 rootBlock identity 合并；独立的正文、批注和新增块不互相覆盖。并发重排不猜测意图。 */
export function rebaseEditorDocument(base: ProseMirrorNode, local: ProseMirrorNode, remote: ProseMirrorNode): ProseMirrorNode {
  if (local.eq(base) || local.eq(remote)) return remote;
  if (remote.eq(base)) return local;
  const baseRoots = roots(base), localRoots = roots(local), remoteRoots = roots(remote);
  const baselineIds = [...baseRoots.keys()];
  const localOrder = [...localRoots.keys()].filter(id => baseRoots.has(id));
  const remoteOrder = [...remoteRoots.keys()].filter(id => baseRoots.has(id));
  const reordered = (order: string[]) => {
    const present = new Set(order);
    return order.join('\0') !== baselineIds.filter(id => present.has(id)).join('\0');
  };
  if (reordered(localOrder) || reordered(remoteOrder)) {
    throw new Error('文档发生并发重排，已保留本地内容，请先处理冲突。');
  }
  const merged = new Map<string, ProseMirrorNode>();
  for (const id of new Set([...baseRoots.keys(), ...localRoots.keys(), ...remoteRoots.keys()])) {
    const before = baseRoots.get(id), left = localRoots.get(id), right = remoteRoots.get(id);
    if (!before) {
      if (left && right && !left.eq(right)) throw new Error(`新增块身份冲突: ${id}`);
      const added = left ?? right;
      if (added) merged.set(id, added);
    } else if (!left || !right) {
      const survivor = left ?? right;
      if (survivor && !survivor.eq(before)) throw new Error(`块删除与编辑冲突: ${id}`);
    } else merged.set(id, rebaseEditorNode(before, left, right));
  }
  const insertions = new Map<string | undefined, string[]>();
  let predecessor: string | undefined;
  for (const id of localRoots.keys()) {
    if (remoteRoots.has(id)) predecessor = id;
    else if (!baseRoots.has(id)) {
      const group = insertions.get(predecessor) ?? [];
      group.push(id);
      insertions.set(predecessor, group);
    }
  }
  const order = [...(insertions.get(undefined) ?? [])];
  for (const id of remoteRoots.keys()) order.push(id, ...(insertions.get(id) ?? []));
  return remote.copy(Fragment.from(order.flatMap(id => {
    const node = merged.get(id);
    return node ? [node] : [];
  })));
}
