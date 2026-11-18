import type { KnowledgeCliCommand } from '../definitions/knowledgeCliCommand';
import { KnowledgeCliPermissionError } from '../definitions/knowledgeCliErrors';
import type { KnowledgeCliLink, KnowledgeCliScope } from '../definitions/knowledgeCliScope';
import { resolveProjectKnowledgeBaseScope } from '../../tools/scope';

/** 调用方须传入成功查询的当前项目关联；查询失败不能伪装为空关联。 */
export function resolveKnowledgeCliScope(
  projectId: string | undefined,
  links: readonly KnowledgeCliLink[],
): KnowledgeCliScope {
  if (!projectId?.trim()) {
    throw new KnowledgeCliPermissionError('当前对话未绑定项目，不能访问知识库。');
  }
  const scope = resolveProjectKnowledgeBaseScope(projectId, links.map(link => link.kbId));
  return {
    projectId: scope.projectId,
    kbIds: scope.kbIds,
    links: links.map(link => ({ kbId: link.kbId, role: link.role })),
  };
}

/** 项目角色只决定业务准入；父 Shell 的内部数据/写权限仍由 Host 单独检查。 */
export function assertKnowledgeCliAccess(scope: KnowledgeCliScope, command: KnowledgeCliCommand): void {
  if (command.action === 'list') return;
  if (!scope.kbIds.includes(command.kbId)) {
    throw new KnowledgeCliPermissionError(`当前项目未关联知识库 ${command.kbId}，不能跨项目访问。`);
  }
  if (command.action === 'documents.list' || command.action === 'index.status') return;

  const link = scope.links.find(candidate => candidate.kbId === command.kbId);
  if (command.action === 'unlink') {
    if (!link) throw new KnowledgeCliPermissionError('默认读取范围不是显式关联，不能解除；此操作不会删除知识库。');
    return;
  }
  if (link?.role !== 'read_write') {
    throw new KnowledgeCliPermissionError('导入、删除资料和重建索引需要当前项目与该知识库的显式读写关联。');
  }
}
