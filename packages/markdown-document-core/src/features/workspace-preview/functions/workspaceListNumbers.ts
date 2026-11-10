import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface WorkspaceListNumber {
  readonly rootPosition: number;
  readonly rootId: string;
  readonly level: number;
  readonly value: number;
}

/** 延续正式列表的四层编号、显式重起与中断规则；预览不另建 CSS counter 语义。 */
export function workspaceListNumbers(doc: ProseMirrorNode): WorkspaceListNumber[] {
  const counters = [0, 0, 0, 0], inRun = [false, false, false, false];
  const result: WorkspaceListNumber[] = [];
  doc.forEach((root, rootPosition) => {
    const node = root.firstChild;
    if (root.type.name !== 'rootBlock' || node?.type.name !== 'listItemBlock' || node.attrs.listType !== 'ordered') {
      counters.fill(0); inRun.fill(false);
      return;
    }
    const rawLevel: unknown = node.attrs.level, rawStart: unknown = node.attrs.start;
    const level = Math.max(0, Math.min(3, typeof rawLevel === 'number' ? rawLevel : 0));
    const start = typeof rawStart === 'number' && Number.isFinite(rawStart) && rawStart >= 0 ? Math.floor(rawStart) : null;
    const value = start ?? (inRun[level] ? counters[level] + 1 : 1);
    counters[level] = value; inRun[level] = true;
    for (let i = level + 1; i <= 3; i++) { counters[i] = 0; inRun[i] = false; }
    result.push({ rootPosition, rootId: typeof root.attrs.id === 'string' ? root.attrs.id : String(rootPosition), level, value });
  });
  return result;
}
