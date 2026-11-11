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

function actorText(actor: SemanticSchemaActor): string {
  const conversation = actor.conversation_id === null ? '' : `，对话“${actor.conversation_title ?? actor.conversation_id}”`;
  switch (actor.kind) {
    case 'user': return '用户';
    case 'plugin': return '插件';
    case 'external': return `命令行${conversation}`;
    case 'run':
    case 'subrun': return `${actor.agent_id ?? 'Agent'}${conversation}`;
  }
}

export function formatSchemaChanges(changes: readonly SemanticSchemaChangeItem[]): string {
  if (!changes.length) return '还没有标签和字段的改动。\n';
  return `${changes.map(change => {
    const filters = change.saved_filter_count ? `，改写 ${change.saved_filter_count} 个保存的筛选` : '';
    const state = change.undone_at === null ? '' : '（已撤回）';
    return `${change.id}  ${schemaChangeText(change.summary)}${filters}${state}  ${actorText(change.actor)} ${formatAgentTimestamp(change.created_at)}`;
  }).join('\n')}\n`;
}

/** 执行前的影响。 */
export function formatSchemaPreview(operation: SchemaManageOperation, preview: SemanticSchemaPreview): string {
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
      const sample = (items: typeof preview.samples.converted) => items
        .map(item => `“${item.from}”${item.to === null ? '' : ` → ${item.to}`}（${item.document.title}）`).join('，');
      lines.push(`- ${preview.total} 个已填的值：${preview.converted} 个能转，${preview.failed} 个转不了，${preview.emptied} 个会变空`);
      if (preview.samples.converted.length) lines.push(`  能转：${sample(preview.samples.converted)}`);
      if (preview.samples.failed.length) lines.push(`  转不了：${sample(preview.samples.failed)}`);
      if (preview.samples.emptied.length) lines.push(`  会变空：${sample(preview.samples.emptied)}`);
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
  if (preview.saved_filters.length) {
    lines.push(`- 改写保存的筛选：${preview.saved_filters.map(filter => `“${filter.name}”（${filter.project_name}）`).join('、')}`);
  }
  lines.push('标签和字段整个工作区共用，会影响所有项目。确认无误后加 --yes 执行。');
  return `${lines.join('\n')}\n`;
}

export function formatSchemaApplied(change: SemanticSchemaChangeItem): string {
  const filters = change.saved_filter_count ? `，改写了 ${change.saved_filter_count} 个保存的筛选` : '';
  return `已执行：${schemaChangeText(change.summary)}${filters}。改动编号 ${change.id}；要撤回：linnya schema undo ${change.id} --yes\n`;
}
