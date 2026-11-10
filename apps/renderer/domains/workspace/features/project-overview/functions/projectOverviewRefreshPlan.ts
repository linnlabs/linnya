import type { WorkspaceMutationEvent } from '@app/schemas';

import type { ProjectOverviewRefreshPlan } from '../definitions/projectOverview';

/** 只看与当前项目有关的变化：正文更新只补读那一份，新建、删除、改名、移动会改变结构，整表重读。 */
export function refreshPlanFor(event: WorkspaceMutationEvent, projectId: string): ProjectOverviewRefreshPlan {
  switch (event.type) {
    case 'workspace.document.updated':
      return event.projectId === projectId ? { kind: 'documents', id: event.documentId } : { kind: 'none' };
    case 'workspace.node.created':
    case 'workspace.node.renamed':
    case 'workspace.node.moved':
    case 'workspace.node.deleted':
      return event.projectId === projectId ? { kind: 'all' } : { kind: 'none' };
    case 'workspace.node.transferred':
      return event.sourceProjectId === projectId || event.targetProjectId === projectId ? { kind: 'all' } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
