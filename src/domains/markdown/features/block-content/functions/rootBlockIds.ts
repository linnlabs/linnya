/**
 * @file block-ids.util.ts
 * @description 与 Markdown 文档块 ID（rootBlock.attrs.id）相关的纯函数工具。
 *
 * 这些工具不直接依赖数据库，只负责在给定的 ProseMirror JSON 上提取块 ID 集合，
 * 便于在不同服务中复用（例如写入前的一致性校验、孤儿数据清理等）。
 */

/**
 * 轻量版的 ProseMirror 文档结构定义：
 * 这里只关心顶层 doc.content 下的 rootBlock 节点及其 attrs.id。
 */
export interface ProseMirrorDocLike {
  content?: unknown;
}

/**
 * 从 ProseMirror 文档 JSON 中提取当前所有顶层 rootBlock 的 blockId 集合。
 *
 * - 仅检查顶层 rootBlock 列表，不深入子节点，符合当前块模型；
 * - 如果结构异常或不存在 content 数组，则返回空集合。
 */
export function getCurrentRootBlockIdSetFromDoc(doc: ProseMirrorDocLike | null | undefined): Set<string> {
  const ids = new Set<string>();

  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) {
    return ids;
  }

  const content = doc.content as unknown[];

  for (const node of content) {
    if (!node || typeof node !== 'object') {
      continue;
    }

    const maybeRoot = node as {
      type?: unknown;
      attrs?: { id?: unknown; [key: string]: unknown };
    };

    if (
      maybeRoot.type === 'rootBlock' &&
      maybeRoot.attrs &&
      typeof maybeRoot.attrs.id === 'string' &&
      maybeRoot.attrs.id.length > 0
    ) {
      ids.add(maybeRoot.attrs.id);
    }
  }

  return ids;
}


