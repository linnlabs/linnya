import type Database from 'better-sqlite3';

import { createRunAgentsReader, currentActionActor } from '../../../action-ledger';
import type { SemanticObjectKind } from '../../definitions/semanticLayer';
import type { SemanticChangeActor } from '../../features/schema-changes/definitions/semanticSchemaChanges';

/** 每个对象保留的历史版本数。对象写入和字段改动重写值都按它裁剪。 */
export const KEPT_SEMANTIC_VERSIONS = 50;

/** 对象行的身份列：文档对象记 document_id，对话对象记 conversation_id，便于随所属对象级联删除。 */
export function semanticObjectColumns(kind: SemanticObjectKind, id: string) {
  return [kind, id, kind === 'document' ? id : null, kind === 'conversation' ? id : null] as const;
}

/**
 * 写入对象当前值并留一份版本快照，只保留最近 {@link KEPT_SEMANTIC_VERSIONS} 个版本。
 * 调用方在事务里先算好新版本号和值；标签增删由调用方自己处理。
 */
export function recordSemanticObjectVersion(db: Database.Database, input: {
  readonly kind: SemanticObjectKind;
  readonly id: string;
  readonly revision: number;
  readonly tagIds: readonly string[];
  readonly valuesJson: string;
  readonly at: number;
}): void {
  const columns = semanticObjectColumns(input.kind, input.id);
  db.prepare(`
    INSERT INTO semantic_object_values (object_kind, object_id, document_id, conversation_id, revision, property_values, updated_at)
    VALUES (?, ?, ?, ?, ?, jsonb(?), ?)
    ON CONFLICT (object_kind, object_id) DO UPDATE SET
      revision = excluded.revision, property_values = excluded.property_values, updated_at = excluded.updated_at
  `).run(...columns, input.revision, input.valuesJson, input.at);
  db.prepare(`
    INSERT INTO semantic_object_versions (object_kind, object_id, document_id, conversation_id, revision, tag_ids_json, property_values, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, jsonb(?), ?)
  `).run(...columns, input.revision, JSON.stringify(input.tagIds), input.valuesJson, input.at);
  db.prepare('DELETE FROM semantic_object_versions WHERE object_kind = ? AND object_id = ? AND revision <= ?')
    .run(input.kind, input.id, input.revision - KEPT_SEMANTIC_VERSIONS);
}

/**
 * 当前写入的操作者。运行、子运行和带运行的外部调用都记到发起它的对话、运行、Agent 与根运行 Agent；
 * 没有登记操作者时算用户。标签/字段的创建者与结构改动记录共用这一份规则。
 */
export function createSemanticActorReader(db: Database.Database): () => SemanticChangeActor {
  const readRunAgents = createRunAgentsReader(db);
  return () => {
    const actor = currentActionActor();
    const run = actor?.kind === 'run' || actor?.kind === 'subrun' ? actor
      : actor?.kind === 'external' ? actor.run : undefined;
    const agents = run ? readRunAgents(run) : { agentId: null, rootAgentId: null };
    return {
      kind: actor?.kind ?? 'user',
      conversationId: run?.conversationId ?? null,
      runId: run?.runId ?? null,
      agentId: agents.agentId,
      rootAgentId: agents.rootAgentId,
    };
  };
}
