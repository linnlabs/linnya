import type Database from 'better-sqlite3';
import {
  PromptKeys,
  SemanticSchemaChangeSummarySchema,
  type ProjectSavedFilterDefinition,
  type SemanticSchemaActor,
  type SemanticSchemaChangeItem,
  type SemanticSchemaManageRequest,
  type SemanticSchemaManageResult,
  type SemanticSchemaOperation,
  type SemanticSchemaOverview,
  type SemanticSchemaPreview,
  type SemanticSchemaUsage,
} from '@app/schemas';
import {
  createSqliteSemanticLayer,
  findSimilarSemanticNames,
  semanticNameKey,
  SemanticLayerError,
  type SemanticChangeActor,
  type SemanticCreator,
  type SemanticObjectRef,
  type SemanticSchemaChange,
  type SqliteSemanticLayer,
} from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { createSqliteSavedFilterStore } from '../../../adapters/persistence/saved-filters';
import { rewriteSavedFilterDefinition, type SavedFilterRewrite } from '../functions/rewriteSavedFilterDefinition';

const USAGE_DOCUMENT_LIMIT = 200;
const CHANGE_LIMIT = 50;
const SAVED_FILTERS_KEY = 'savedFilters';

interface SavedFilterRecord {
  readonly project_id: string;
  readonly id: string;
  readonly before: ProjectSavedFilterDefinition;
  readonly after: ProjectSavedFilterDefinition;
}

interface DocumentRow { readonly id: string; readonly name: string; readonly type: string; readonly project_id: string | null }

/** 预览时用于回滚的哨兵：试做一次，取到结果后整体撤销。 */
class DryRun<T> extends Error {
  constructor(readonly value: T) {
    super('dry run');
  }
}

function layerOf(db: Database.Database): SqliteSemanticLayer {
  return createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
}

function keyOf(name: string): string | null {
  try {
    return semanticNameKey(name);
  } catch {
    return null;
  }
}

function resolveId(items: readonly { readonly id: string; readonly name: string }[], ref: string): string | null {
  return (items.find(item => item.id === ref) ?? items.find(item => semanticNameKey(item.name) === keyOf(ref)))?.id ?? null;
}

/** 文档（文件夹除外）；默认只取不在回收站的。 */
function readDocuments(db: Database.Database, ids: readonly string[], includeTrashed = false): Map<string, DocumentRow> {
  if (!ids.length) return new Map();
  const rows = db.prepare<[string], DocumentRow>(`
    SELECT id, name, type, project_id FROM workspace_nodes
    WHERE id IN (SELECT value FROM json_each(?)) AND type <> 'folder' ${includeTrashed ? '' : 'AND deleted_at IS NULL'}
  `).all(JSON.stringify([...new Set(ids)]));
  return new Map(rows.map(row => [row.id, row]));
}

function documentItem(row: DocumentRow) {
  return { id: row.id, title: row.name, node_type: row.type, project_id: row.project_id };
}

function liveDocumentIds(db: Database.Database, refs: readonly SemanticObjectRef[]): string[] {
  const documents = readDocuments(db, refs.filter(ref => ref.kind === 'document').map(ref => ref.id));
  return refs.filter(ref => documents.has(ref.id)).map(ref => ref.id);
}

function conversationTitles(db: Database.Database, ids: readonly (string | null)[]): Map<string, string | null> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (!wanted.length) return new Map();
  return new Map(db.prepare<[string], { conversation_id: string; title: string | null }>(
    'SELECT conversation_id, title FROM conversations WHERE conversation_id IN (SELECT value FROM json_each(?))',
  ).all(JSON.stringify(wanted)).map(row => [row.conversation_id, row.title]));
}

function actorItem(actor: SemanticChangeActor | SemanticCreator, titles: ReadonlyMap<string, string | null>): SemanticSchemaActor {
  return {
    kind: actor.kind,
    conversation_id: actor.conversationId,
    conversation_title: actor.conversationId === null ? null : titles.get(actor.conversationId) ?? null,
    // 默认 Agent 也会记成它的 ID；合同里统一为 null，界面显示 Linnya AI。
    agent_id: actor.agentId === PromptKeys.DEFAULT ? null : actor.agentId,
  };
}

function savedFilterRecords(change: SemanticSchemaChange): SavedFilterRecord[] {
  const records = change.attachments[SAVED_FILTERS_KEY];
  return Array.isArray(records) ? records as SavedFilterRecord[] : [];
}

function changeItem(change: SemanticSchemaChange, titles: ReadonlyMap<string, string | null>): SemanticSchemaChangeItem {
  return {
    id: change.id,
    // 存的是改动当时的摘要；按合同校验，也换成合同的可变数组形状。
    summary: SemanticSchemaChangeSummarySchema.parse(change.summary),
    actor: actorItem(change.actor, titles),
    saved_filter_count: savedFilterRecords(change).length,
    created_at: change.createdAt,
    undone_at: change.undoneAt,
  };
}

/** 管理界面一次读出：标签、字段（带文档数）和最近改动。 */
export function readSemanticSchemaOverview(db: Database.Database): SemanticSchemaOverview {
  const layer = layerOf(db);
  const tags = layer.listTags();
  const properties = layer.listProperties();
  const changes = layer.listChanges(CHANGE_LIMIT);
  const tagCounts = new Map(db.prepare<[], { tag_id: string; count: number }>(`
    SELECT object_tag.tag_id, COUNT(*) AS count FROM semantic_object_tags object_tag
    JOIN workspace_nodes node ON node.id = object_tag.document_id AND node.deleted_at IS NULL
    GROUP BY object_tag.tag_id
  `).all().map(row => [row.tag_id, row.count]));
  const valueCounts = new Map<string, number>();
  for (const row of db.prepare<[], { property_values: string }>(`
    SELECT json(value.property_values) AS property_values FROM semantic_object_values value
    JOIN workspace_nodes node ON node.id = value.document_id AND node.deleted_at IS NULL
  `).all()) {
    for (const id of Object.keys(JSON.parse(row.property_values) as object)) valueCounts.set(id, (valueCounts.get(id) ?? 0) + 1);
  }
  const titles = conversationTitles(db, [
    ...tags.map(tag => tag.createdBy?.conversationId ?? null),
    ...changes.map(change => change.actor.conversationId),
  ]);
  return {
    tags: tags.map(tag => ({
      id: tag.id,
      name: tag.name,
      document_count: tagCounts.get(tag.id) ?? 0,
      similar: findSimilarSemanticNames(tag.name, tags.filter(other => other.id !== tag.id))
        .map(other => ({ id: other.id, name: other.name })),
      field_ids: tag.fields.map(field => field.propertyId),
      created_at: tag.createdAt,
      created_by: tag.createdBy ? actorItem(tag.createdBy, titles) : null,
    })),
    properties: properties.map(property => ({
      id: property.id,
      name: property.name,
      value_type: property.valueType,
      options: property.options.map(option => ({ id: option.id, name: option.name })),
      owner_plugin_id: property.ownerPluginId,
      tag_ids: tags.filter(tag => tag.fields.some(field => field.propertyId === property.id)).map(tag => tag.id),
      document_count: valueCounts.get(property.id) ?? 0,
    })),
    changes: changes.map(change => changeItem(change, titles)),
  };
}

function savedFilterItems(db: Database.Database, matches: (definition: ProjectSavedFilterDefinition) => boolean) {
  return createSqliteSavedFilterStore(db).listAll()
    .filter(item => matches(item.filter.definition))
    .map(item => ({
      id: item.filter.id, name: item.filter.name, project_id: item.projectId, project_name: item.projectName,
      layout: item.filter.definition.layout.kind,
    }));
}

/** 用在哪里：带这个标签（或填了这个字段）的文档按项目分组，以及引用它的保存的筛选。 */
export function readSemanticSchemaUsage(db: Database.Database, kind: 'tag' | 'property', id: string): SemanticSchemaUsage {
  const layer = layerOf(db);
  const refs = kind === 'tag' ? layer.taggedObjects(id) : layer.valuedObjects(id);
  const resolved = kind === 'tag' ? resolveId(layer.listTags(), id) : resolveId(layer.listProperties(), id);
  const documents = [...readDocuments(db, refs.filter(ref => ref.kind === 'document').map(ref => ref.id)).values()];
  const projectNames = new Map(db.prepare<[string], { id: string; name: string }>(
    'SELECT id, name FROM projects WHERE id IN (SELECT value FROM json_each(?))',
  ).all(JSON.stringify([...new Set(documents.flatMap(document => document.project_id ?? []))])).map(row => [row.id, row.name]));
  const projects = new Map<string, { id: string; name: string; document_count: number }>();
  for (const document of documents) {
    if (document.project_id === null) continue;
    const project = projects.get(document.project_id)
      ?? { id: document.project_id, name: projectNames.get(document.project_id) ?? '', document_count: 0 };
    projects.set(document.project_id, { ...project, document_count: project.document_count + 1 });
  }
  const collator = new Intl.Collator('zh-CN', { numeric: true });
  const projectOrder = (projectId: string | null) => (projectId === null ? '' : projectNames.get(projectId) ?? '');
  return {
    projects: [...projects.values()].sort((left, right) => collator.compare(left.name, right.name)),
    documents: documents
      .sort((left, right) => collator.compare(projectOrder(left.project_id), projectOrder(right.project_id))
        || collator.compare(left.name, right.name))
      .slice(0, USAGE_DOCUMENT_LIMIT)
      .map(documentItem),
    saved_filters: resolved === null ? [] : savedFilterItems(db, definition => (kind === 'tag'
      ? definition.tags.includes(resolved)
      : definition.where.some(condition => condition.field === resolved) || definition.layout.group_by === resolved)),
  };
}

/** 操作对保存的筛选的改写规则；名称在操作前解析成 ID（删除、合并后就查不到了）。 */
function rewriteFor(layer: SqliteSemanticLayer, operation: SemanticSchemaOperation): SavedFilterRewrite | null {
  switch (operation.op) {
    case 'rename_tag':
    case 'rename_property':
      return null;
    case 'merge_tags': {
      const from = resolveId(layer.listTags(), operation.source);
      const to = resolveId(layer.listTags(), operation.target);
      return from && to ? { kind: 'replace_tag', from, to } : null;
    }
    case 'delete_tag': {
      const tagId = resolveId(layer.listTags(), operation.tag);
      return tagId ? { kind: 'drop_tag', tagId } : null;
    }
    case 'delete_property': {
      const fieldId = resolveId(layer.listProperties(), operation.property);
      return fieldId ? { kind: 'drop_field', fieldId } : null;
    }
    case 'change_property_type': {
      const fieldId = resolveId(layer.listProperties(), operation.property);
      return fieldId ? { kind: 'retype_field', fieldId, groupable: operation.value_type === 'select' } : null;
    }
    case 'update_options': {
      const property = layer.listProperties().find(item => item.id === resolveId(layer.listProperties(), operation.property));
      if (!property) return null;
      const kept = new Set(operation.options.flatMap(option => option.id ?? []));
      const optionIds = property.options.filter(option => !kept.has(option.id)).map(option => option.id);
      return optionIds.length ? { kind: 'drop_options', fieldId: property.id, optionIds } : null;
    }
  }
}

function runOperation(layer: SqliteSemanticLayer, operation: SemanticSchemaOperation): SemanticSchemaChange {
  switch (operation.op) {
    case 'rename_tag': return layer.renameTag(operation.tag, operation.name, { allowSimilar: operation.allow_similar });
    case 'merge_tags': return layer.mergeTags(operation.source, operation.target);
    case 'delete_tag': return layer.deleteTag(operation.tag);
    case 'rename_property': return layer.renameProperty(operation.property, operation.name, { allowSimilar: operation.allow_similar });
    case 'delete_property': return layer.deleteProperty(operation.property);
    case 'change_property_type': return layer.changePropertyType(operation.property, operation.value_type);
    case 'update_options': return layer.updatePropertyOptions(operation.property, operation.options);
  }
}

/** 执行前看影响：多少文档、合并补哪些字段、改类型每个值会怎样、哪些保存的筛选要改写。不写库。 */
export function previewSemanticSchemaOperation(db: Database.Database, operation: SemanticSchemaOperation): SemanticSchemaPreview {
  const layer = layerOf(db);
  const rewrite = rewriteFor(layer, operation);
  const savedFilters = rewrite === null ? [] : savedFilterItems(db, definition => rewriteSavedFilterDefinition(definition, rewrite) !== null);
  switch (operation.op) {
    case 'merge_tags':
    case 'delete_tag': {
      const impact = operation.op === 'merge_tags'
        ? layer.previewTagChange(operation.source, operation.target)
        : layer.previewTagChange(operation.tag);
      return {
        kind: 'tag',
        documents: liveDocumentIds(db, impact.objects).length,
        already_target: liveDocumentIds(db, impact.alreadyTarget).length,
        added_fields: [...impact.addedFields],
        saved_filters: savedFilters,
      };
    }
    case 'change_property_type': {
      const preview = layer.previewPropertyType(operation.property, operation.value_type);
      const documents = readDocuments(db, [
        ...preview.samples.converted, ...preview.samples.failed, ...preview.samples.emptied,
      ].map(sample => sample.ref.id), true);
      const samples = (list: typeof preview.samples.converted) => list.flatMap(sample => {
        const document = documents.get(sample.ref.id);
        return document ? [{ document: documentItem(document), from: sample.from, to: sample.to }] : [];
      });
      return {
        kind: 'type',
        total: preview.total, converted: preview.converted, failed: preview.failed, emptied: preview.emptied,
        to_options: preview.toOptions.map(option => ({ id: option.id, name: option.name })),
        samples: { converted: samples(preview.samples.converted), failed: samples(preview.samples.failed), emptied: samples(preview.samples.emptied) },
        saved_filters: savedFilters,
      };
    }
    case 'update_options': {
      // 试做一次取到准确的影响，再整体回滚。
      try {
        db.transaction(() => {
          throw new DryRun(layer.updatePropertyOptions(operation.property, operation.options).summary);
        })();
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
        const summary = (error as DryRun<SemanticSchemaChange['summary']>).value;
        if (summary.kind !== 'update_options') throw new Error('选项预览得到了别的改动');
        return { kind: 'options', removed: [...summary.removed], documents: summary.objects, saved_filters: savedFilters };
      }
      throw new Error('选项预览没有回滚');
    }
    case 'rename_tag':
    case 'rename_property':
    case 'delete_property':
      return { kind: 'simple', saved_filters: savedFilters };
  }
}

/** 执行一次改动：语义层的改动和保存的筛选的改写在同一事务里；筛选改写前后的定义附在这批改动上。 */
export function applySemanticSchemaOperation(db: Database.Database, operation: SemanticSchemaOperation): SemanticSchemaChangeItem {
  const layer = layerOf(db);
  const change = db.transaction((): SemanticSchemaChange => {
    const rewrite = rewriteFor(layer, operation);
    const result = runOperation(layer, operation);
    if (rewrite === null) return result;
    const store = createSqliteSavedFilterStore(db);
    const records: SavedFilterRecord[] = [];
    for (const { projectId, filter } of store.listAll()) {
      const after = rewriteSavedFilterDefinition(filter.definition, rewrite);
      if (after === null) continue;
      store.replaceDefinition(projectId, filter.id, after);
      records.push({ project_id: projectId, id: filter.id, before: filter.definition, after });
    }
    if (records.length) layer.attachToChange(result.id, SAVED_FILTERS_KEY, records);
    return layer.readChange(result.id);
  }).immediate();
  return changeItem(change, conversationTitles(db, [change.actor.conversationId]));
}

/** 整批撤回；保存的筛选之后又被改过的不恢复，返回跳过的个数。 */
export function undoSemanticSchemaChange(db: Database.Database, changeId: string): { change: SemanticSchemaChangeItem; savedFiltersSkipped: number } {
  const layer = layerOf(db);
  return db.transaction(() => {
    const { change } = layer.undoChange(changeId);
    const store = createSqliteSavedFilterStore(db);
    const current = new Map(store.listAll().map(item => [item.filter.id, item.filter.definition]));
    let skipped = 0;
    for (const record of savedFilterRecords(change)) {
      const definition = current.get(record.id);
      if (!definition || JSON.stringify(definition) !== JSON.stringify(record.after)) {
        skipped += 1;
        continue;
      }
      store.replaceDefinition(record.project_id, record.id, record.before);
    }
    return { change: changeItem(change, conversationTitles(db, [change.actor.conversationId])), savedFiltersSkipped: skipped };
  }).immediate();
}

function failure(error: SemanticLayerError): SemanticSchemaManageResult {
  const candidates = error.details?.candidates;
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(Array.isArray(candidates) ? { candidates: candidates as { id: string; name: string }[] } : {}),
  };
}

/** 界面入口。执行者由 Renderer 请求入口绑定为用户。 */
export function manageSemanticSchema(db: Database.Database, request: SemanticSchemaManageRequest): SemanticSchemaManageResult {
  try {
    switch (request.action) {
      case 'read':
        return { ok: true, action: 'read', overview: readSemanticSchemaOverview(db) };
      case 'usage':
        return { ok: true, action: 'usage', usage: readSemanticSchemaUsage(db, request.kind, request.id) };
      case 'preview':
        return { ok: true, action: 'preview', preview: previewSemanticSchemaOperation(db, request.operation) };
      case 'apply': {
        const change = applySemanticSchemaOperation(db, request.operation);
        return { ok: true, action: 'apply', change, overview: readSemanticSchemaOverview(db) };
      }
      case 'set_tag_fields': {
        const layer = layerOf(db);
        const tag = layer.listTags().find(item => item.id === resolveId(layer.listTags(), request.tag));
        // 留下的字段沿用原来的默认值。
        const defaults = new Map(tag?.fields.map(field => [field.propertyId, field.defaultValue]) ?? []);
        layer.setTagFields(request.tag, request.field_ids.map(propertyId => {
          const defaultValue = defaults.get(propertyId);
          return defaultValue === undefined ? { propertyId } : { propertyId, defaultValue };
        }));
        return { ok: true, action: 'set_tag_fields', overview: readSemanticSchemaOverview(db) };
      }
      case 'undo': {
        const { change, savedFiltersSkipped } = undoSemanticSchemaChange(db, request.change_id);
        return { ok: true, action: 'undo', change, overview: readSemanticSchemaOverview(db), saved_filters_skipped: savedFiltersSkipped };
      }
    }
  } catch (error) {
    if (error instanceof SemanticLayerError) return failure(error);
    throw error;
  }
}
