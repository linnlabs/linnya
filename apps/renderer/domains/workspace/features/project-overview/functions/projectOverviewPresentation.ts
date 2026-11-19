import type { ProjectOverviewActor } from '@app/schemas';
import type { LinnyaLocale } from '@app/localization';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import type { ProjectOverviewSortKey } from '../definitions/projectOverview';

/**
 * Agent 显示名。null 是默认 Agent，显示为 Linnya Agent；其他 Agent 用注册表里的名字，
 * 查不到（例如所属插件已停用）时显示注册表 ID。“Linnya AI”只是 Linnya 全部 AI 功能的泛称，不作为任何 Agent 的名字。
 */
export function resolveProjectOverviewAgentName(
  agentId: string | null,
  agentNames: ReadonlyMap<string, string>,
  message: WorkspaceMessageResolver,
): string {
  if (agentId === null) return message('workspace.projectOverview.actor.defaultAgent');
  return agentNames.get(agentId) ?? agentId;
}

/**
 * 名字由调用方查好：插件从插件注册表查，查不到时统称“插件”；主运行的 Agent 见 `resolveProjectOverviewAgentName`。
 * 子运行显示为“子任务”：子 Agent 是 Agent 内部的协作，没有面向用户的名字，与对话“本次改动”里的“子任务新建/修改”一致。
 */
export function formatProjectOverviewActor(
  actor: ProjectOverviewActor,
  names: { readonly pluginName: string | null; readonly agentName: string },
  message: WorkspaceMessageResolver,
): string {
  switch (actor) {
    case 'run': return names.agentName;
    case 'subrun': return message('workspace.projectOverview.actor.subrun');
    case 'user': return message('workspace.projectOverview.actor.user');
    case 'external': return message('workspace.projectOverview.actor.external');
    case 'plugin': return names.pluginName ?? message('workspace.projectOverview.actor.plugin');
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
