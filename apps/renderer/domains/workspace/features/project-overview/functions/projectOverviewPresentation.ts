import type { ProjectOverviewActor } from '@app/schemas';
import type { LinnyaLocale } from '@app/localization';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import type { ProjectOverviewSortKey } from '../definitions/projectOverview';

/** 插件的显示名由调用方从插件注册表查；查不到时统称“插件”。 */
export function formatProjectOverviewActor(
  actor: ProjectOverviewActor,
  pluginName: string | null,
  message: WorkspaceMessageResolver,
): string {
  switch (actor) {
    case 'linnya_ai': return message('workspace.projectOverview.actor.linnyaAi');
    case 'user': return message('workspace.projectOverview.actor.user');
    case 'external': return message('workspace.projectOverview.actor.external');
    case 'plugin': return pluginName ?? message('workspace.projectOverview.actor.plugin');
  }
}

export function formatProjectOverviewCharacters(count: number, locale: LinnyaLocale): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

export function projectOverviewColumnMessageKey(id: ProjectOverviewSortKey): WorkspaceMessageKey {
  switch (id) {
    case 'name': return 'workspace.projectOverview.column.name';
    case 'tags': return 'workspace.projectOverview.column.tags';
    case 'location': return 'workspace.projectOverview.column.location';
    case 'source': return 'workspace.projectOverview.column.source';
    case 'conversation': return 'workspace.projectOverview.column.conversation';
    case 'modified': return 'workspace.projectOverview.column.modified';
    case 'pending': return 'workspace.projectOverview.column.pending';
    case 'type': return 'workspace.projectOverview.column.type';
    case 'created': return 'workspace.projectOverview.column.created';
  }
}

/** 时间和数量默认从大到小，文字默认从小到大。 */
export function defaultProjectOverviewSortDirection(key: ProjectOverviewSortKey): 'asc' | 'desc' {
  return key === 'modified' || key === 'created' || key === 'pending' ? 'desc' : 'asc';
}
