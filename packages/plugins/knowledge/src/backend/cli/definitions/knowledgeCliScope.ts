import type { ProjectKnowledgeBaseLink } from '../../infrastructure/sqlite/project-knowledge-base-links.types';

export type KnowledgeCliLink = Readonly<Pick<ProjectKnowledgeBaseLink, 'kbId' | 'role'>>;

export interface KnowledgeCliScope {
  readonly projectId: string;
  readonly kbIds: readonly string[];
  /** 保留显式关联事实，不能把无关联时的 default 读范围变成写权限。 */
  readonly links: readonly KnowledgeCliLink[];
}
