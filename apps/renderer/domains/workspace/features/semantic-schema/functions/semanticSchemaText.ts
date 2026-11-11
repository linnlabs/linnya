import type {
  SemanticSchemaActor,
  SemanticSchemaChangeItem,
  SemanticSchemaChangeSummaryValue,
  SemanticValueTypeValue,
} from '@app/schemas';
import type { WorkspaceMessageKey, WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

/** 界面上可选的字段类型，按常用程度排。 */
export const SEMANTIC_VALUE_TYPE_ORDER: readonly SemanticValueTypeValue[] = [
  'text', 'number', 'date', 'datetime', 'select', 'multi_select', 'checkbox', 'url',
];

const TYPE_KEYS: Record<SemanticValueTypeValue, WorkspaceMessageKey> = {
  text: 'workspace.semanticSchema.type.text',
  number: 'workspace.semanticSchema.type.number',
  date: 'workspace.semanticSchema.type.date',
  datetime: 'workspace.semanticSchema.type.datetime',
  checkbox: 'workspace.semanticSchema.type.checkbox',
  select: 'workspace.semanticSchema.type.select',
  multi_select: 'workspace.semanticSchema.type.multiSelect',
  url: 'workspace.semanticSchema.type.url',
};

export function valueTypeLabel(type: SemanticValueTypeValue, message: WorkspaceMessageResolver): string {
  return message(TYPE_KEYS[type]);
}

/** 名称列表：“A”“B”。 */
export function quotedNames(names: readonly string[]): string {
  return names.map(name => `“${name}”`).join('');
}

export interface SemanticSchemaTextContext {
  readonly message: WorkspaceMessageResolver;
  /** Agent 显示名；null 是默认 Agent，查不到时为 null。 */
  readonly agentName: (agentId: string | null) => string | null;
  readonly timeText: (timestamp: number) => string;
}

/** 谁做的：你、Linnya AI（或具体 Agent）带对话名、命令行、插件。 */
export function actorText(actor: SemanticSchemaActor, context: SemanticSchemaTextContext): string {
  const { message } = context;
  const conversation = actor.conversation_id === null
    ? null
    : message('workspace.semanticSchema.actor.conversation', { title: actor.conversation_title ?? actor.conversation_id });
  const who = (() => {
    switch (actor.kind) {
      case 'user': return message('workspace.semanticSchema.actor.user');
      case 'plugin': return message('workspace.semanticSchema.actor.plugin');
      case 'external': return message('workspace.semanticSchema.actor.external');
      case 'run':
      case 'subrun':
        return context.agentName(actor.agent_id) ?? actor.agent_id ?? message('workspace.projectOverview.actor.linnyaAi');
    }
  })();
  return conversation ? `${who} · ${conversation}` : who;
}

/** 标签详情里“谁在什么时候新建”。迁移前建的标签没有记录，只给时间。 */
export function tagOriginText(actor: SemanticSchemaActor | null, createdAt: number, context: SemanticSchemaTextContext): string {
  const { message } = context;
  const time = context.timeText(createdAt);
  if (actor === null) return message('workspace.semanticSchema.origin.unknown', { time });
  if (actor.kind === 'user') return message('workspace.semanticSchema.origin.user', { time });
  if (actor.kind === 'run' || actor.kind === 'subrun') {
    const agent = context.agentName(actor.agent_id) ?? actor.agent_id ?? message('workspace.projectOverview.actor.linnyaAi');
    return actor.conversation_id === null
      ? message('workspace.semanticSchema.origin.agent', { agent, time })
      : message('workspace.semanticSchema.origin.agentInConversation', {
        agent, time, conversation: actor.conversation_title ?? actor.conversation_id,
      });
  }
  return message('workspace.semanticSchema.origin.other', { who: actorText(actor, context), time });
}

/** 一批改动的一句话；名称是改动当时的名称。 */
export function changeSummaryText(summary: SemanticSchemaChangeSummaryValue, message: WorkspaceMessageResolver): string {
  switch (summary.kind) {
    case 'rename_tag': return message('workspace.semanticSchema.summary.renameTag', { from: summary.from, to: summary.to });
    case 'merge_tags': return message('workspace.semanticSchema.summary.mergeTags', { source: summary.source, target: summary.target });
    case 'delete_tag': return message('workspace.semanticSchema.summary.deleteTag', { tag: summary.tag });
    case 'rename_property': return message('workspace.semanticSchema.summary.renameProperty', { from: summary.from, to: summary.to });
    case 'delete_property': return message('workspace.semanticSchema.summary.deleteProperty', { property: summary.property });
    case 'change_property_type':
      return message('workspace.semanticSchema.summary.changeType', {
        property: summary.property, type: valueTypeLabel(summary.toType, message),
      });
    case 'update_options': {
      const parts = [
        summary.added.length ? message('workspace.semanticSchema.summary.optionsAdded', { names: quotedNames(summary.added) }) : '',
        summary.renamed.length
          ? message('workspace.semanticSchema.summary.optionsRenamed', { names: summary.renamed.map(item => `${item.from} → ${item.to}`).join('、') })
          : '',
        summary.removed.length ? message('workspace.semanticSchema.summary.optionsRemoved', { names: quotedNames(summary.removed) }) : '',
      ].filter(Boolean);
      return message('workspace.semanticSchema.summary.updateOptions', {
        property: summary.property,
        parts: parts.length ? parts.join('，') : message('workspace.semanticSchema.summary.optionsReordered'),
      });
    }
  }
}

/** 最近改动一行的说明：影响了多少文档和保存的筛选、谁做的、什么时候。 */
export function changeMetaText(change: SemanticSchemaChangeItem, context: SemanticSchemaTextContext): string {
  const { message } = context;
  const { summary } = change;
  const parts: string[] = [];
  if (summary.kind === 'change_property_type') {
    parts.push(summary.failed
      ? message('workspace.semanticSchema.meta.converted', { count: summary.objects, failed: summary.failed })
      : message('workspace.semanticSchema.meta.documents', { count: summary.objects }));
  } else if ((summary.kind === 'merge_tags' || summary.kind === 'delete_tag' || summary.kind === 'update_options') && summary.objects) {
    parts.push(message('workspace.semanticSchema.meta.documents', { count: summary.objects }));
  }
  if (change.saved_filter_count) parts.push(message('workspace.semanticSchema.meta.filters', { count: change.saved_filter_count }));
  parts.push(actorText(change.actor, context), context.timeText(change.created_at));
  return parts.join(' · ');
}

/** 名称匹配查找：忽略大小写与全角半角。 */
export function matchesQuery(name: string, query: string): boolean {
  const key = query.normalize('NFKC').trim().toLowerCase();
  return key === '' || name.normalize('NFKC').toLowerCase().includes(key);
}
