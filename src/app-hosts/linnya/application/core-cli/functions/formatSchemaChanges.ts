import {
  formatAgentTimestamp,
  type SemanticSchemaActor,
  type SemanticSchemaChangeItem,
  type SemanticSchemaChangeSummaryValue,
  type SemanticSchemaPreview,
} from '@app/schemas';
import type { SchemaManageOperation } from './parseSemanticCommands';

const list = (names: readonly string[]) => names.map(name => `“${name}”`).join('、');

/** 一批改动的一句话描述；名称是改动当时的名称。 */
export function schemaChangeText(summary: SemanticSchemaChangeSummaryValue): string {
  switch (summary.kind) {
    case 'rename_tag': return `标签改名：${summary.from} → ${summary.to}`;
    case 'merge_tags': return `合并标签：${summary.source} → ${summary.target}（${summary.objects} 份文档）`;
    case 'delete_tag': return `删除标签“${summary.tag}”（${summary.objects} 份文档）`;
    case 'rename_property': return `字段改名：${summary.from} → ${summary.to}`;
    case 'delete_property': return `删除字段“${summary.property}”`;
    case 'change_property_type':
      return `字段“${summary.property}”从 ${summary.fromType} 改成 ${summary.toType}（${summary.objects} 个值，${summary.failed} 个转不了或变空）`;
    case 'update_options': {
      const parts = [
        summary.added.length ? `新增 ${list(summary.added)}` : '',
        summary.renamed.length ? `改名 ${summary.renamed.map(item => `${item.from}→${item.to}`).join('、')}` : '',
        summary.removed.length ? `删除 ${list(summary.removed)}（${summary.objects} 份文档的值清除）` : '',
      ].filter(Boolean);
      return `字段“${summary.property}”的选项：${parts.join('；') || '调整顺序'}`;
    }
  }
}

/**
 * 命令行只看当前项目：对话标题与编号只在对话属于当前项目时显示，其他项目的只说明来自其他项目。
 * 标签、字段名是整个工作区共用的定义，照常显示。
 */
function actorText(actor: SemanticSchemaActor, visibleConversationIds: ReadonlySet<string>): string {
  const conversation = actor.conversation_id === null ? ''
    : visibleConversationIds.has(actor.conversation_id)
      ? `，对话“${actor.conversation_title ?? actor.conversation_id}”`
      : '，其他项目的对话';
  switch (actor.kind) {
    case 'user': return '用户';
    case 'plugin': return '插件';
    case 'external': return `命令行${conversation}`;
    case 'run':
    case 'subrun': return `${actor.agent_id ?? 'Agent'}${conversation}`;
  }
}

export function formatSchemaChanges(
  changes: readonly SemanticSchemaChangeItem[],
  visibleConversationIds: ReadonlySet<string>,
): string {
  if (!changes.length) return '还没有标签和字段的改动。\n';
  return `${changes.map(change => {
    const filters = change.saved_filter_count ? `，改写 ${change.saved_filter_count} 个保存的筛选` : '';
    const state = change.undone_at === null ? '' : '（已撤回）';
    return `${change.id}  ${schemaChangeText(change.summary)}${filters}${state}  ${actorText(change.actor, visibleConversationIds)} ${formatAgentTimestamp(change.created_at)}`;
  }).join('\n')}\n`;
}

/** 执行前的影响。个数按整个工作区（改动影响所有项目），文档名、原值与保存的筛选名只列当前项目的。 */
export function formatSchemaPreview(
  operation: SchemaManageOperation,
  preview: SemanticSchemaPreview,
  projectId: string | null,
): string {
  const lines: string[] = [];
  switch (operation.op) {
    case 'rename_tag': lines.push(`将把标签“${operation.tag}”改名为“${operation.name}”。`); break;
    case 'rename_property': lines.push(`将把字段“${operation.property}”改名为“${operation.name}”。`); break;
    case 'merge_tags': lines.push(`将把标签“${operation.source}”合并到“${operation.target}”，之后只剩“${operation.target}”：`); break;
    case 'delete_tag': lines.push(`将删除标签“${operation.tag}”：`); break;
    case 'delete_property': lines.push(`将删除字段“${operation.property}”：从所有标签里去掉，已填的值保留，撤回后原样显示。`); break;
    case 'change_property_type': lines.push(`将把字段“${operation.property}”改成 ${operation.valueType}：`); break;
    case 'update_options': lines.push(`将把字段“${operation.property}”的选项改为 ${list(operation.options.map(option => option.name))}：`); break;
  }
  switch (preview.kind) {
    case 'tag':
      if (operation.op === 'merge_tags') {
        lines.push(`- ${preview.documents} 份文档改带“${operation.target}”${preview.already_target ? `（其中 ${preview.already_target} 份已带）` : ''}，字段值不变`);
        if (preview.added_fields.length) lines.push(`- “${operation.target}”加上字段 ${list(preview.added_fields)}`);
      } else {
        lines.push(`- 从 ${preview.documents} 份文档上去掉，它们的字段值保留`);
      }
      break;
    case 'type': {
      const own = (items: typeof preview.samples.converted) => items.filter(item => item.document.project_id === projectId);
      const sample = (items: typeof preview.samples.converted) => own(items)
        .map(item => `“${item.from}”${item.to === null ? '' : ` → ${item.to}`}（${item.document.title}）`).join('，');
      lines.push(`- ${preview.total} 个已填的值：${preview.converted} 个能转，${preview.failed} 个转不了，${preview.emptied} 个会变空`);
      if (own(preview.samples.converted).length) lines.push(`  能转：${sample(preview.samples.converted)}`);
      if (own(preview.samples.failed).length) lines.push(`  转不了：${sample(preview.samples.failed)}`);
      if (own(preview.samples.emptied).length) lines.push(`  会变空：${sample(preview.samples.emptied)}`);
      const shown = [preview.samples.converted, preview.samples.failed, preview.samples.emptied].reduce((sum, items) => sum + own(items).length, 0);
      if (preview.total > shown) lines.push('  其他项目里的值只计入个数，不列出');
      if (preview.to_options.length) lines.push(`- 选项：${list(preview.to_options.map(option => option.name))}`);
      if (preview.failed + preview.emptied) lines.push('- 转不了和变空的值清除，原值记在这次改动里，撤回时恢复');
      break;
    }
    case 'options':
      if (preview.removed.length) lines.push(`- 删除选项 ${list(preview.removed)}，${preview.documents} 份文档用到它们的值清除`);
      break;
    case 'simple':
      break;
  }
  const ownFilters = preview.saved_filters.filter(filter => filter.project_id === projectId);
  const otherFilters = preview.saved_filters.length - ownFilters.length;
  if (preview.saved_filters.length) {
    const named = ownFilters.map(filter => `“${filter.name}”（${filter.project_name}）`).join('、');
    const others = otherFilters ? `另有 ${otherFilters} 个其他项目的保存的筛选` : '';
    lines.push(`- 改写保存的筛选：${[named, others].filter(Boolean).join('；')}`);
  }
  lines.push('标签和字段整个工作区共用，会影响所有项目。确认无误后加 --yes 执行。');
  return `${lines.join('\n')}\n`;
}

export function formatSchemaApplied(change: SemanticSchemaChangeItem): string {
  const filters = change.saved_filter_count ? `，改写了 ${change.saved_filter_count} 个保存的筛选` : '';
  return `已执行：${schemaChangeText(change.summary)}${filters}。改动编号 ${change.id}；要撤回：linnya schema undo ${change.id} --yes\n`;
}
