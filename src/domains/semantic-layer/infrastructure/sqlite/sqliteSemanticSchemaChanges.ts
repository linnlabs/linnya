import type Database from 'better-sqlite3';

import { createRunAgentIdReader, currentActionActor } from '../../../action-ledger';
import {
  SemanticLayerError,
  type SemanticDocumentPort,
  type SemanticObjectKind,
  type SemanticObjectRef,
  type SemanticPropertyDefinition,
  type SemanticSelectOption,
  type SemanticTagDefinition,
  type SemanticValue,
  type SemanticValueType,
} from '../../definitions/semanticLayer';
import { cleanSemanticName, semanticNameKey } from '../../functions/normalizeSemanticName';
import {
  SEMANTIC_SCHEMA_CHANGE_KINDS,
  type SemanticChangeActor,
  type SemanticConversionSample,
  type SemanticOptionInput,
  type SemanticSchemaChange,
  type SemanticSchemaChangeKind,
  type SemanticSchemaChangeSummary,
  type SemanticTagImpact,
  type SemanticTypeChangePreview,
  type SemanticUndoResult,
} from '../../features/schema-changes/definitions/semanticSchemaChanges';
import {
  convertSemanticValue,
  optionsForConversion,
  semanticValueText,
} from '../../features/schema-changes/functions/convertSemanticValue';

const KEPT_VERSIONS = 50;
const SAMPLE_LIMIT = 5;

type Values = Record<string, SemanticValue>;

interface ObjectRow { readonly object_kind: SemanticObjectKind; readonly object_id: string }
interface TaggedRow extends ObjectRow { readonly created_at: number }
interface ValuedRow extends ObjectRow { readonly property_values: string }
interface ChangeRow {
  readonly id: string;
  readonly kind: string;
  readonly summary_json: string;
  readonly undo_json: string;
  readonly attachments_json: string;
  readonly actor_kind: string;
  readonly conversation_id: string | null;
  readonly run_id: string | null;
  readonly agent_id: string | null;
  readonly created_at: number;
  readonly undone_at: number | null;
}

interface TaggedObject { readonly kind: SemanticObjectKind; readonly id: string; readonly createdAt: number }
interface ValueBefore { readonly kind: SemanticObjectKind; readonly id: string; readonly before: SemanticValue }

/** 撤回所需的差量，按种类各一种形状；只在本文件内读写。 */
type UndoData =
  | { readonly kind: 'rename_tag'; readonly tagId: string; readonly from: string; readonly to: string }
  | {
    readonly kind: 'merge_tags'; readonly sourceId: string; readonly targetId: string;
    readonly objects: readonly (TaggedObject & { readonly hadTarget: boolean })[];
    readonly addedFields: readonly string[];
  }
  | { readonly kind: 'delete_tag'; readonly tagId: string; readonly objects: readonly TaggedObject[] }
  | { readonly kind: 'rename_property'; readonly propertyId: string; readonly from: string; readonly to: string }
  | { readonly kind: 'delete_property'; readonly propertyId: string }
  | {
    readonly kind: 'change_property_type'; readonly propertyId: string;
    readonly from: { readonly valueType: SemanticValueType; readonly options: readonly SemanticSelectOption[] };
    readonly to: { readonly valueType: SemanticValueType; readonly options: readonly SemanticSelectOption[] };
    readonly values: readonly ValueBefore[];
  }
  | {
    readonly kind: 'update_options'; readonly propertyId: string;
    readonly before: readonly SemanticSelectOption[]; readonly after: readonly SemanticSelectOption[];
    readonly values: readonly ValueBefore[];
  };

export interface SemanticSchemaChangeContext {
  readonly db: Database.Database;
  readonly now: () => number;
  readonly newId: () => string;
  readonly documents: SemanticDocumentPort;
  readonly tags: () => SemanticTagDefinition[];
  readonly properties: () => SemanticPropertyDefinition[];
  readonly resolveTag: (all: readonly SemanticTagDefinition[], idOrName: string) => SemanticTagDefinition;
  readonly resolveProperty: (all: readonly SemanticPropertyDefinition[], idOrName: string) => SemanticPropertyDefinition;
  readonly assertNewName: (
    kind: 'tag' | 'property', name: string,
    existing: readonly { readonly id: string; readonly name: string }[], allowSimilar: boolean
  ) => void;
}

function withoutKey(values: Values, key: string): Values {
  return Object.fromEntries(Object.entries(values).filter(([id]) => id !== key));
}

function assertKind(value: string): SemanticSchemaChangeKind {
  const kind = SEMANTIC_SCHEMA_CHANGE_KINDS.find(candidate => candidate === value);
  if (!kind) throw new Error(`semantic_schema_changes.kind 不在合同范围内：${value}`);
  return kind;
}

function assertActorKind(value: string): SemanticChangeActor['kind'] {
  const kinds = ['user', 'run', 'subrun', 'plugin', 'external'] as const;
  const kind = kinds.find(candidate => candidate === value);
  if (!kind) throw new Error(`semantic_schema_changes.actor_kind 不在合同范围内：${value}`);
  return kind;
}

/**
 * 标签与字段本身的改动。每个操作是一个事务，记一行改动批次；受影响对象各加一个版本、留快照，
 * 让别处按旧版本的写入报冲突。撤回按差量反向应用，不整份覆盖，之后别处对同一对象的改动保留。
 */
export function createSqliteSemanticSchemaChanges(context: SemanticSchemaChangeContext) {
  const { db, now, newId, documents } = context;
  const readRunAgentId = createRunAgentIdReader(db);

  const readValues = db.prepare<[string, string], { revision: number; property_values: string }>(`
    SELECT revision, json(property_values) AS property_values
    FROM semantic_object_values WHERE object_kind = ? AND object_id = ?
  `);
  const readTagIds = db.prepare<[string, string], { tag_id: string }>(`
    SELECT object_tag.tag_id FROM semantic_object_tags object_tag
    JOIN semantic_tags tag ON tag.id = object_tag.tag_id AND tag.deleted_at IS NULL
    WHERE object_tag.object_kind = ? AND object_tag.object_id = ?
    ORDER BY object_tag.created_at, object_tag.tag_id
  `);
  const taggedWith = db.prepare<[string], TaggedRow>(`
    SELECT object_kind, object_id, created_at FROM semantic_object_tags WHERE tag_id = ? ORDER BY object_kind, object_id
  `);
  const valuedWith = db.prepare<[string], ValuedRow>(`
    SELECT object_kind, object_id, json(property_values) AS property_values FROM semantic_object_values
    WHERE json_type(property_values, '$."' || ? || '"') IS NOT NULL
    ORDER BY updated_at, object_id
  `);
  const insertObjectTag = db.prepare(`
    INSERT OR IGNORE INTO semantic_object_tags (object_kind, object_id, document_id, conversation_id, tag_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const deleteObjectTag = db.prepare('DELETE FROM semantic_object_tags WHERE object_kind = ? AND object_id = ? AND tag_id = ?');

  const columns = (kind: SemanticObjectKind, id: string) =>
    [kind, id, kind === 'document' ? id : null, kind === 'conversation' ? id : null] as const;

  /** 对象仍在（文档没被物理删除）。对话对象第一版不开放，按不存在处理。 */
  function objectExists(kind: SemanticObjectKind, id: string): boolean {
    return kind === 'document' && documents.read(id) !== null;
  }

  /** 改过标签或值后给对象加一个版本并留快照；mutate 给出新值时一并写入。 */
  function bumpObject(kind: SemanticObjectKind, id: string, at: number, mutate?: (values: Values) => Values): void {
    const row = readValues.get(kind, id);
    const current = row ? JSON.parse(row.property_values) as Values : {};
    const values = mutate ? mutate({ ...current }) : current;
    const revision = (row?.revision ?? 0) + 1;
    const valuesJson = JSON.stringify(values);
    db.prepare(`
      INSERT INTO semantic_object_values (object_kind, object_id, document_id, conversation_id, revision, property_values, updated_at)
      VALUES (?, ?, ?, ?, ?, jsonb(?), ?)
      ON CONFLICT (object_kind, object_id) DO UPDATE SET
        revision = excluded.revision, property_values = excluded.property_values, updated_at = excluded.updated_at
    `).run(...columns(kind, id), revision, valuesJson, at);
    const tagIds = readTagIds.all(kind, id).map(item => item.tag_id);
    db.prepare(`
      INSERT INTO semantic_object_versions (object_kind, object_id, document_id, conversation_id, revision, tag_ids_json, property_values, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, jsonb(?), ?)
    `).run(...columns(kind, id), revision, JSON.stringify(tagIds), valuesJson, at);
    db.prepare('DELETE FROM semantic_object_versions WHERE object_kind = ? AND object_id = ? AND revision <= ?')
      .run(kind, id, revision - KEPT_VERSIONS);
  }

  function actor(): SemanticChangeActor {
    const current = currentActionActor();
    const run = current?.kind === 'run' || current?.kind === 'subrun' ? current
      : current?.kind === 'external' ? current.run : undefined;
    return {
      kind: current?.kind ?? 'user',
      conversationId: run?.conversationId ?? null,
      runId: run?.runId ?? null,
      agentId: run ? readRunAgentId(run.runId) : null,
    };
  }

  function record(summary: SemanticSchemaChangeSummary, undo: UndoData, at: number): SemanticSchemaChange {
    const id = newId();
    const who = actor();
    db.prepare(`
      INSERT INTO semantic_schema_changes
        (id, kind, summary_json, undo_json, attachments_json, actor_kind, conversation_id, run_id, agent_id, created_at, undone_at)
      VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, NULL)
    `).run(id, summary.kind, JSON.stringify(summary), JSON.stringify(undo), who.kind, who.conversationId, who.runId, who.agentId, at);
    return { id, summary, actor: who, createdAt: at, undoneAt: null, attachments: {} };
  }

  function toChange(row: ChangeRow): SemanticSchemaChange {
    assertKind(row.kind);
    return {
      id: row.id,
      summary: JSON.parse(row.summary_json) as SemanticSchemaChangeSummary,
      actor: {
        kind: assertActorKind(row.actor_kind),
        conversationId: row.conversation_id,
        runId: row.run_id,
        agentId: row.agent_id,
      },
      createdAt: row.created_at,
      undoneAt: row.undone_at,
      attachments: JSON.parse(row.attachments_json) as Record<string, unknown>,
    };
  }

  function readChangeRow(id: string): ChangeRow {
    const row = db.prepare<[string], ChangeRow>('SELECT * FROM semantic_schema_changes WHERE id = ?').get(id);
    if (!row) throw new SemanticLayerError('change_not_found', `找不到改动 ${id}`);
    return row;
  }

  function definitionRow(table: 'semantic_tags' | 'semantic_properties', id: string) {
    return db.prepare<[string], { name: string; deleted_at: number | null }>(`SELECT name, deleted_at FROM ${table} WHERE id = ?`).get(id);
  }

  /** 撤回删除或合并前，名称不能已被新建的同名定义占用。 */
  function assertNameFree(table: 'semantic_tags' | 'semantic_properties', id: string, label: string): void {
    const row = definitionRow(table, id);
    if (!row) throw new SemanticLayerError('undo_conflict', `${label}已不存在，无法撤回`);
    const taken = db.prepare<[string, string], { name: string }>(
      `SELECT name FROM ${table} WHERE name_key = ? AND deleted_at IS NULL AND id <> ?`
    ).get(semanticNameKey(row.name), id);
    if (taken) {
      throw new SemanticLayerError('undo_conflict', `已经有同名的“${taken.name}”，先改名或删掉它再撤回`);
    }
  }

  function writeOptions(propertyId: string, valueType: SemanticValueType, options: readonly SemanticSelectOption[]): void {
    db.prepare('UPDATE semantic_properties SET value_type = ?, options_json = ? WHERE id = ?')
      .run(valueType, JSON.stringify(options), propertyId);
  }

  function editableProperty(idOrName: string): SemanticPropertyDefinition {
    const property = context.resolveProperty(context.properties(), idOrName);
    if (property.ownerPluginId) {
      throw new SemanticLayerError('readonly_property', `字段“${property.name}”由插件维护，不能在这里改`);
    }
    return property;
  }

  function rename(kind: 'tag' | 'property', idOrName: string, rawName: string, allowSimilar: boolean): SemanticSchemaChange {
    return db.transaction((): SemanticSchemaChange => {
      const name = cleanSemanticName(rawName);
      const table = kind === 'tag' ? 'semantic_tags' : 'semantic_properties';
      const target = kind === 'tag' ? context.resolveTag(context.tags(), idOrName) : editableProperty(idOrName);
      if (kind === 'property' && name.includes('.')) {
        throw new SemanticLayerError('reserved_name', '字段名不能含“.”：带点的名称留给插件声明的字段');
      }
      if (name === target.name) {
        throw new SemanticLayerError('invalid_definition', `新名称与原名称相同：“${name}”`);
      }
      const others = (kind === 'tag' ? context.tags() : context.properties()).filter(item => item.id !== target.id);
      context.assertNewName(kind, name, others, allowSimilar);
      db.prepare(`UPDATE ${table} SET name = ?, name_key = ? WHERE id = ?`).run(name, semanticNameKey(name), target.id);
      const at = now();
      return kind === 'tag'
        ? record({ kind: 'rename_tag', from: target.name, to: name }, { kind: 'rename_tag', tagId: target.id, from: target.name, to: name }, at)
        : record({ kind: 'rename_property', from: target.name, to: name }, { kind: 'rename_property', propertyId: target.id, from: target.name, to: name }, at);
    }).immediate();
  }

  function tagImpact(sourceIdOrName: string, targetIdOrName?: string): SemanticTagImpact & { readonly rows: readonly TaggedRow[] } {
    const all = context.tags();
    const source = context.resolveTag(all, sourceIdOrName);
    const target = targetIdOrName === undefined ? undefined : context.resolveTag(all, targetIdOrName);
    if (target && target.id === source.id) {
      throw new SemanticLayerError('invalid_definition', '不能把标签合并到它自己');
    }
    const rows = taggedWith.all(source.id);
    const targetObjects = new Set(target ? taggedWith.all(target.id).map(row => `${row.object_kind}:${row.object_id}`) : []);
    const fieldNames = new Map(context.properties().map(property => [property.id, property.name]));
    return {
      tag: { id: source.id, name: source.name },
      rows,
      objects: rows.map(row => ({ kind: row.object_kind, id: row.object_id })),
      alreadyTarget: rows.filter(row => targetObjects.has(`${row.object_kind}:${row.object_id}`))
        .map(row => ({ kind: row.object_kind, id: row.object_id })),
      addedFields: target
        ? source.fields.filter(field => !target.fields.some(existing => existing.propertyId === field.propertyId))
          .flatMap(field => fieldNames.get(field.propertyId) ?? [])
        : [],
    };
  }

  /** 预览改类型：逐个已填的值试转，不写库。 */
  function typePreview(idOrName: string, toType: SemanticValueType) {
    const property = editableProperty(idOrName);
    if (property.valueType === toType) {
      throw new SemanticLayerError('invalid_definition', `“${property.name}”已经是这个类型`);
    }
    const rows = valuedWith.all(property.id).map(row => ({
      ...row, value: (JSON.parse(row.property_values) as Values)[property.id],
    })).filter((row): row is typeof row & { value: SemanticValue } => row.value !== undefined);
    const toOptions = optionsForConversion(property, toType, rows.map(row => semanticValueText(property, row.value)), newId);
    const target: SemanticPropertyDefinition = { ...property, valueType: toType, options: toOptions };
    const outcomes = rows.map(row => ({ row, outcome: convertSemanticValue(property, row.value, toType, toOptions) }));
    const sample = (kind: 'converted' | 'failed' | 'emptied'): SemanticConversionSample[] => outcomes
      .filter(item => item.outcome.kind === kind).slice(0, SAMPLE_LIMIT)
      .map(({ row, outcome }) => ({
        ref: { kind: row.object_kind, id: row.object_id },
        from: semanticValueText(property, row.value),
        to: outcome.kind === 'converted' ? semanticValueText(target, outcome.value) : null,
      }));
    const preview: SemanticTypeChangePreview = {
      property: { id: property.id, name: property.name, valueType: property.valueType },
      toType,
      toOptions,
      total: outcomes.length,
      converted: outcomes.filter(item => item.outcome.kind === 'converted').length,
      failed: outcomes.filter(item => item.outcome.kind === 'failed').length,
      emptied: outcomes.filter(item => item.outcome.kind === 'emptied').length,
      samples: { converted: sample('converted'), failed: sample('failed'), emptied: sample('emptied') },
    };
    return { property, preview, outcomes };
  }

  function undoData(row: ChangeRow): UndoData {
    return JSON.parse(row.undo_json) as UndoData;
  }

  function applyUndo(undo: UndoData, at: number): void {
    switch (undo.kind) {
      case 'rename_tag':
      case 'rename_property': {
        const table = undo.kind === 'rename_tag' ? 'semantic_tags' : 'semantic_properties';
        const id = undo.kind === 'rename_tag' ? undo.tagId : undo.propertyId;
        const row = definitionRow(table, id);
        if (!row || row.deleted_at !== null) throw new SemanticLayerError('undo_conflict', `“${undo.to}”已被删除，无法改回原名`);
        if (row.name !== undo.to) throw new SemanticLayerError('undo_conflict', `“${undo.to}”之后又改名为“${row.name}”，先撤回后来的改动`);
        const taken = db.prepare<[string, string], { name: string }>(
          `SELECT name FROM ${table} WHERE name_key = ? AND deleted_at IS NULL AND id <> ?`
        ).get(semanticNameKey(undo.from), id);
        if (taken) throw new SemanticLayerError('undo_conflict', `已经有“${taken.name}”，无法改回原名`);
        db.prepare(`UPDATE ${table} SET name = ?, name_key = ? WHERE id = ?`).run(undo.from, semanticNameKey(undo.from), id);
        return;
      }
      case 'merge_tags': {
        assertNameFree('semantic_tags', undo.sourceId, '原标签');
        db.prepare('UPDATE semantic_tags SET deleted_at = NULL WHERE id = ?').run(undo.sourceId);
        const removeField = db.prepare('DELETE FROM semantic_tag_fields WHERE tag_id = ? AND property_id = ?');
        for (const propertyId of undo.addedFields) removeField.run(undo.targetId, propertyId);
        for (const object of undo.objects) {
          if (!objectExists(object.kind, object.id)) continue;
          insertObjectTag.run(...columns(object.kind, object.id), undo.sourceId, object.createdAt);
          if (!object.hadTarget) deleteObjectTag.run(object.kind, object.id, undo.targetId);
          bumpObject(object.kind, object.id, at);
        }
        return;
      }
      case 'delete_tag': {
        assertNameFree('semantic_tags', undo.tagId, '标签');
        db.prepare('UPDATE semantic_tags SET deleted_at = NULL WHERE id = ?').run(undo.tagId);
        for (const object of undo.objects) {
          if (!objectExists(object.kind, object.id)) continue;
          insertObjectTag.run(...columns(object.kind, object.id), undo.tagId, object.createdAt);
          bumpObject(object.kind, object.id, at);
        }
        return;
      }
      case 'delete_property': {
        assertNameFree('semantic_properties', undo.propertyId, '字段');
        db.prepare('UPDATE semantic_properties SET deleted_at = NULL WHERE id = ?').run(undo.propertyId);
        return;
      }
      case 'change_property_type':
      case 'update_options': {
        const property = context.properties().find(item => item.id === undo.propertyId);
        if (!property) throw new SemanticLayerError('undo_conflict', '这个字段已被删除，先撤回删除');
        const expected = undo.kind === 'change_property_type' ? undo.to : { valueType: property.valueType, options: undo.after };
        if (property.valueType !== expected.valueType) {
          throw new SemanticLayerError('undo_conflict', `“${property.name}”之后又改过类型，先撤回后来的改动`);
        }
        if (JSON.stringify(property.options) !== JSON.stringify(expected.options)) {
          throw new SemanticLayerError('undo_conflict', `“${property.name}”之后又改过选项，先撤回后来的改动`);
        }
        if (undo.kind === 'change_property_type') writeOptions(property.id, undo.from.valueType, undo.from.options);
        else writeOptions(property.id, property.valueType, undo.before);
        for (const item of undo.values) {
          if (!objectExists(item.kind, item.id)) continue;
          bumpObject(item.kind, item.id, at, values => ({ ...values, [property.id]: item.before }));
        }
        return;
      }
    }
  }

  return {
    renameTag(idOrName: string, name: string, options: { readonly allowSimilar?: boolean } = {}): SemanticSchemaChange {
      return rename('tag', idOrName, name, options.allowSimilar === true);
    },

    renameProperty(idOrName: string, name: string, options: { readonly allowSimilar?: boolean } = {}): SemanticSchemaChange {
      return rename('property', idOrName, name, options.allowSimilar === true);
    },

    /** 删除或合并前的影响范围：带这个标签的对象；合并时另给已带目标标签的对象和目标要加的字段。 */
    previewTagChange(sourceIdOrName: string, targetIdOrName?: string): SemanticTagImpact {
      const impact = tagImpact(sourceIdOrName, targetIdOrName);
      return { tag: impact.tag, objects: impact.objects, alreadyTarget: impact.alreadyTarget, addedFields: impact.addedFields };
    },

    /**
     * 合并：带来源标签的对象改带目标标签（已带的只去掉来源），目标标签补上来源带的字段，
     * 来源标签软删除。对象的字段值不动。
     */
    mergeTags(sourceIdOrName: string, targetIdOrName: string): SemanticSchemaChange {
      return db.transaction((): SemanticSchemaChange => {
        const all = context.tags();
        const source = context.resolveTag(all, sourceIdOrName);
        const target = context.resolveTag(all, targetIdOrName);
        const impact = tagImpact(source.id, target.id);
        const at = now();
        const hadTarget = new Set(impact.alreadyTarget.map(ref => `${ref.kind}:${ref.id}`));
        const addedFields = source.fields.filter(field => !target.fields.some(existing => existing.propertyId === field.propertyId));
        const position = db.prepare<[string], { next: number }>(
          'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM semantic_tag_fields WHERE tag_id = ?'
        ).get(target.id)?.next ?? 0;
        addedFields.forEach((field, index) => db.prepare(
          'INSERT INTO semantic_tag_fields (tag_id, property_id, position, default_json) VALUES (?, ?, ?, ?)'
        ).run(target.id, field.propertyId, position + index, field.defaultValue === undefined ? null : JSON.stringify(field.defaultValue)));
        const objects = impact.rows.map(row => ({
          kind: row.object_kind, id: row.object_id, createdAt: row.created_at,
          hadTarget: hadTarget.has(`${row.object_kind}:${row.object_id}`),
        }));
        for (const object of objects) {
          deleteObjectTag.run(object.kind, object.id, source.id);
          if (!object.hadTarget) insertObjectTag.run(...columns(object.kind, object.id), target.id, object.createdAt);
          bumpObject(object.kind, object.id, at);
        }
        db.prepare('UPDATE semantic_tags SET deleted_at = ? WHERE id = ?').run(at, source.id);
        return record(
          { kind: 'merge_tags', source: source.name, target: target.name, objects: objects.length },
          { kind: 'merge_tags', sourceId: source.id, targetId: target.id, objects, addedFields: addedFields.map(field => field.propertyId) },
          at,
        );
      }).immediate();
    },

    /** 删除标签：从对象上去掉、标签软删除。它带来的字段值保留，撤回后标签和字段一起回来。 */
    deleteTag(idOrName: string): SemanticSchemaChange {
      return db.transaction((): SemanticSchemaChange => {
        const impact = tagImpact(idOrName);
        const at = now();
        const objects = impact.rows.map(row => ({ kind: row.object_kind, id: row.object_id, createdAt: row.created_at }));
        for (const object of objects) {
          deleteObjectTag.run(object.kind, object.id, impact.tag.id);
          bumpObject(object.kind, object.id, at);
        }
        db.prepare('UPDATE semantic_tags SET deleted_at = ? WHERE id = ?').run(at, impact.tag.id);
        return record(
          { kind: 'delete_tag', tag: impact.tag.name, objects: objects.length },
          { kind: 'delete_tag', tagId: impact.tag.id, objects },
          at,
        );
      }).immediate();
    },

    /** 删除字段：软删除，从各标签的字段里消失；已存的值不动，撤回后原样显示。 */
    deleteProperty(idOrName: string): SemanticSchemaChange {
      return db.transaction((): SemanticSchemaChange => {
        const property = editableProperty(idOrName);
        const at = now();
        db.prepare('UPDATE semantic_properties SET deleted_at = ? WHERE id = ?').run(at, property.id);
        return record({ kind: 'delete_property', property: property.name }, { kind: 'delete_property', propertyId: property.id }, at);
      }).immediate();
    },

    previewPropertyType(idOrName: string, toType: SemanticValueType): SemanticTypeChangePreview {
      return typePreview(idOrName, toType).preview;
    },

    /** 改类型：能转的换成新类型的值，转不了与变空的清除；原值全部记进这批改动，撤回时恢复。 */
    changePropertyType(idOrName: string, toType: SemanticValueType): SemanticSchemaChange {
      return db.transaction((): SemanticSchemaChange => {
        const { property, preview, outcomes } = typePreview(idOrName, toType);
        const at = now();
        writeOptions(property.id, toType, preview.toOptions);
        for (const { row, outcome } of outcomes) {
          bumpObject(row.object_kind, row.object_id, at, values => {
            return outcome.kind === 'converted' ? { ...values, [property.id]: outcome.value } : withoutKey(values, property.id);
          });
        }
        return record(
          {
            kind: 'change_property_type', property: property.name, fromType: property.valueType, toType,
            objects: preview.total, failed: preview.failed + preview.emptied,
          },
          {
            kind: 'change_property_type', propertyId: property.id,
            from: { valueType: property.valueType, options: property.options },
            to: { valueType: toType, options: preview.toOptions },
            values: outcomes.map(({ row }) => ({ kind: row.object_kind, id: row.object_id, before: row.value })),
          },
          at,
        );
      }).immediate();
    },

    /**
     * 编辑单选、多选的选项：带 ID 的保留（可改名、调顺序），不带 ID 的新建，没列出的删除；
     * 用到被删选项的值随之清除（多选只去掉那一项），原值记进这批改动。
     */
    updatePropertyOptions(idOrName: string, input: readonly SemanticOptionInput[]): SemanticSchemaChange {
      return db.transaction((): SemanticSchemaChange => {
        const property = editableProperty(idOrName);
        if (property.valueType !== 'select' && property.valueType !== 'multi_select') {
          throw new SemanticLayerError('invalid_definition', `“${property.name}”不是单选或多选，没有选项`);
        }
        const after = input.map(option => {
          if (option.id !== undefined && !property.options.some(existing => existing.id === option.id)) {
            throw new SemanticLayerError('invalid_definition', `“${property.name}”没有选项 ${option.id}`);
          }
          return { id: option.id ?? newId(), name: cleanSemanticName(option.name) };
        });
        if (after.length === 0) throw new SemanticLayerError('invalid_definition', '至少要留一个选项');
        const keys = after.map(option => option.name.normalize('NFKC').toLowerCase());
        if (new Set(keys).size !== keys.length) throw new SemanticLayerError('invalid_definition', '选项名重复');
        const kept = new Set(after.map(option => option.id));
        const removed = property.options.filter(option => !kept.has(option.id));
        const removedIds = new Set(removed.map(option => option.id));
        const at = now();
        writeOptions(property.id, property.valueType, after);
        const values: ValueBefore[] = [];
        if (removedIds.size) {
          for (const row of valuedWith.all(property.id)) {
            const before = (JSON.parse(row.property_values) as Values)[property.id];
            if (before === undefined) continue;
            const list = Array.isArray(before) ? before : [before];
            if (!list.some(id => typeof id === 'string' && removedIds.has(id))) continue;
            values.push({ kind: row.object_kind, id: row.object_id, before });
            const rest = list.filter(id => typeof id === 'string' && !removedIds.has(id));
            bumpObject(row.object_kind, row.object_id, at, current => {
              return property.valueType === 'multi_select' && rest.length
                ? { ...current, [property.id]: rest }
                : withoutKey(current, property.id);
            });
          }
        }
        const beforeById = new Map(property.options.map(option => [option.id, option.name]));
        return record(
          {
            kind: 'update_options', property: property.name,
            added: after.filter(option => !beforeById.has(option.id)).map(option => option.name),
            renamed: after.flatMap(option => {
              const from = beforeById.get(option.id);
              return from !== undefined && from !== option.name ? [{ from, to: option.name }] : [];
            }),
            removed: removed.map(option => option.name),
            objects: values.length,
          },
          { kind: 'update_options', propertyId: property.id, before: property.options, after, values },
          at,
        );
      }).immediate();
    },

    /** 最近的改动，新的在前。 */
    listChanges(limit = 50): SemanticSchemaChange[] {
      return db.prepare<[number], ChangeRow>('SELECT * FROM semantic_schema_changes ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(Math.max(1, Math.min(200, limit))).map(toChange);
    },

    readChange(id: string): SemanticSchemaChange {
      return toChange(readChangeRow(id));
    },

    /** 调用方在同一事务里附上自己的撤回数据；同名键覆盖。 */
    attachToChange(id: string, key: string, value: unknown): void {
      const row = readChangeRow(id);
      const attachments = { ...(JSON.parse(row.attachments_json) as Record<string, unknown>), [key]: value };
      db.prepare('UPDATE semantic_schema_changes SET attachments_json = ? WHERE id = ?').run(JSON.stringify(attachments), id);
    },

    /** 整批撤回；返回改动与附件，调用方据附件恢复自己的部分。已撤回的报错。 */
    undoChange(id: string): SemanticUndoResult {
      return db.transaction((): SemanticUndoResult => {
        const row = readChangeRow(id);
        if (row.undone_at !== null) throw new SemanticLayerError('already_undone', '这批改动已经撤回过了');
        const at = now();
        applyUndo(undoData(row), at);
        db.prepare('UPDATE semantic_schema_changes SET undone_at = ? WHERE id = ?').run(at, id);
        const change = toChange({ ...row, undone_at: at });
        return { change, attachments: change.attachments };
      }).immediate();
    },

    /** 每个标签带着它的对象数；给管理界面列表用，范围由调用方再按自己的规则筛。 */
    taggedObjects(tagIdOrName: string): SemanticObjectRef[] {
      const tag = context.resolveTag(context.tags(), tagIdOrName);
      return taggedWith.all(tag.id).map(row => ({ kind: row.object_kind, id: row.object_id }));
    },

    /** 填了这个字段的对象。 */
    valuedObjects(propertyIdOrName: string): SemanticObjectRef[] {
      const property = context.resolveProperty(context.properties(), propertyIdOrName);
      return valuedWith.all(property.id).map(row => ({ kind: row.object_kind, id: row.object_id }));
    },
  };
}

export type SqliteSemanticSchemaChanges = ReturnType<typeof createSqliteSemanticSchemaChanges>;
