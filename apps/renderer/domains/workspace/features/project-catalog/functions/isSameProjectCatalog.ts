import type { Project } from '../../../definitions/project';

/** 创建回执与事实通知可能返回同一目录；相同内容和顺序不构成新的界面状态。 */
export function isSameProjectCatalog(current: readonly Project[], next: readonly Project[]): boolean {
  return current.length === next.length && current.every((project, index) => {
    const candidate = next[index];
    return candidate !== undefined
      && project.id === candidate.id
      && project.name === candidate.name
      && project.description === candidate.description
      && project.icon === candidate.icon
      && project.systemRole === candidate.systemRole
      && project.canDelete === candidate.canDelete
      && project.createdAt === candidate.createdAt
      && project.updatedAt === candidate.updatedAt;
  });
}
