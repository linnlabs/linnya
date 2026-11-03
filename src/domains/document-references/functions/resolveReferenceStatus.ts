import type { ReferenceNode, ReferenceResolution } from '../definitions/documentReferences';

/** 越界时不返回标题，避免通过预览读取其他项目正文或身份信息。 */
export function resolveReferenceStatus(source: ReferenceNode | null, target: ReferenceNode | null, targetDocumentId: string): ReferenceResolution {
  if (!target || target.deletedAt !== null) {
    return { targetDocumentId, status: 'deleted', title: null, nodeType: null };
  }
  if (!source || source.deletedAt !== null || !source.projectId || source.projectId !== target.projectId) {
    return { targetDocumentId, status: 'outside_project', title: null, nodeType: null };
  }
  return { targetDocumentId, status: 'available', title: target.name, nodeType: target.nodeType };
}
