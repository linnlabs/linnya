import type { ProjectOverviewActor } from '@app/schemas';
import type { LinnyaLocale } from '@app/localization';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import type { ProjectOverviewSortKey } from '../definitions/projectOverview';

const MINUTE_MS = 60_000;

/** 刚刚、几分钟前、今天几点、昨天几点、今年几月几日、更早带年份。 */
export function formatProjectOverviewTime(
  timestamp: number,
  now: Date,
  locale: LinnyaLocale,
  message: WorkspaceMessageResolver,
): string {
  const date = new Date(timestamp);
  const diff = now.getTime() - timestamp;
  if (diff >= 0 && diff < MINUTE_MS) return message('workspace.projectOverview.time.justNow');
  if (diff >= 0 && diff < 60 * MINUTE_MS) {
    return message('workspace.projectOverview.time.minutesAgo', { count: Math.floor(diff / MINUTE_MS) });
  }
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return message('workspace.projectOverview.time.yesterday', { time });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

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
