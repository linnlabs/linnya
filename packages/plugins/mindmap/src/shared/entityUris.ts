export const MINDMAP_DOCUMENT_URI_PREFIX = 'linnya://mindmap/';
export const MINDMAP_NODE_URI_FRAGMENT_PREFIX = '#node/';

/**
 * 生成 Mindmap 文档运行时实体 URI。
 *
 * 中文说明：该 URI 仅用于运行时展示、诊断与跨插件引用表达，禁止写入持久化表作为主键。
 */
export function buildMindmapDocumentUri(documentId: string): string {
  return `${MINDMAP_DOCUMENT_URI_PREFIX}${encodeURIComponent(documentId)}`;
}

/**
 * 生成 Mindmap 节点运行时实体 URI。
 *
 * 中文说明：node URI 依赖 documentId + nodeId 组合定位，同样只作为展示/引用协议，不作为持久化主键。
 */
export function buildMindmapNodeUri(documentId: string, nodeId: string): string {
  return `${buildMindmapDocumentUri(documentId)}${MINDMAP_NODE_URI_FRAGMENT_PREFIX}${encodeURIComponent(nodeId)}`;
}
