import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { createSqliteActionLedger, currentActionActor, type ActionLedgerAction } from '../../../action-ledger';
import {
  SEMANTIC_VALUE_TYPES,
  SemanticLayerError,
  type DefineSemanticPropertyInput,
  type DefineSemanticTagInput,
  type SemanticDocumentPort,
  type SemanticObjectField,
  type SemanticObjectKind,
  type SemanticObjectRef,
  type SemanticObjectState,
  type SemanticObjectWrite,
  type SemanticPropertyDefinition,
  type SemanticTagDefinition,
  type SemanticTagField,
  type SemanticValue,
} from '../../definitions/semanticLayer';
import { findSimilarSemanticNames } from '../../functions/findSimilarSemanticNames';
import { cleanSemanticName, semanticNameKey } from '../../functions/normalizeSemanticName';
import { normalizeSemanticValue } from '../../functions/normalizeSemanticValue';

const KEPT_VERSIONS = 50;

interface PropertyRow {
  readonly id: string;
  readonly name: string;
  readonly value_type: string;
  readonly options_json: string;
  readonly owner_plugin_id: string | null;
  readonly created_at: number;
}
interface TagRow { readonly id: string; readonly name: string; readonly created_at: number }
interface TagFieldRow { readonly tag_id: string; readonly property_id: string; readonly default_json: string | null }
interface ValueRow { readonly revision: number; readonly property_values: string }

type Values = Record<string, SemanticValue>;

interface ObjectDraft {
  readonly tagIds: readonly string[];
  readonly values: Values;
}

export interface SemanticLayerOptions {
  readonly now?: () => number;
  readonly newId?: () => string;
}

function toProperty(row: PropertyRow): SemanticPropertyDefinition {
  const valueType = SEMANTIC_VALUE_TYPES.find(type => type === row.value_type);
  if (!valueType) throw new Error(`semantic_properties.value_type 不受支持：${row.value_type}`);
  return {
    id: row.id,
    name: row.name,
    valueType,
    options: JSON.parse(row.options_json) as SemanticPropertyDefinition['options'],
    ownerPluginId: row.owner_plugin_id,
    createdAt: row.created_at,
  };
}

function sameValues(left: Values, right: Values): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

/**
 * 语义层的 SQLite 实现。所有写入各自是一个事务；已在外层事务中调用时随外层提交或回滚。
 * 写对象时按期望版本比较，改动登记进行动账本（细账，部分为 `properties`）。
 */
export function createSqliteSemanticLayer(
  db: Database.Database,
  documents: SemanticDocumentPort,
  options: SemanticLayerOptions = {}
) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;

  const listPropertyRows = db.prepare<[], PropertyRow>(`
    SELECT id, name, value_type, options_json, owner_plugin_id, created_at
    FROM semantic_properties WHERE deleted_at IS NULL ORDER BY name_key
  `);
  const listTagRows = db.prepare<[], TagRow>(
    'SELECT id, name, created_at FROM semantic_tags WHERE deleted_at IS NULL ORDER BY name_key'
  );
  const listTagFieldRows = db.prepare<[], TagFieldRow>(`
    SELECT field.tag_id, field.property_id, field.default_json
    FROM semantic_tag_fields field
    JOIN semantic_properties property ON property.id = field.property_id AND property.deleted_at IS NULL
    ORDER BY field.tag_id, field.position
  `);
  const readValueRow = db.prepare<[string, string], ValueRow>(`
    SELECT revision, json(property_values) AS property_values
    FROM semantic_object_values WHERE object_kind = ? AND object_id = ?
  `);
  const readObjectTagIds = db.prepare<[string, string], { tag_id: string }>(`
    SELECT object_tag.tag_id FROM semantic_object_tags object_tag
    JOIN semantic_tags tag ON tag.id = object_tag.tag_id AND tag.deleted_at IS NULL
    WHERE object_tag.object_kind = ? AND object_tag.object_id = ?
    ORDER BY object_tag.created_at, object_tag.tag_id
  `);

  function properties(): SemanticPropertyDefinition[] {
    return listPropertyRows.all().map(toProperty);
  }

  function tags(): SemanticTagDefinition[] {
    const fieldsByTag = new Map<string, SemanticTagField[]>();
    for (const row of listTagFieldRows.all()) {
      const fields = fieldsByTag.get(row.tag_id) ?? [];
      fields.push(row.default_json === null
        ? { propertyId: row.property_id }
        : { propertyId: row.property_id, defaultValue: JSON.parse(row.default_json) as SemanticValue });
      fieldsByTag.set(row.tag_id, fields);
    }
    return listTagRows.all().map(row => ({
      id: row.id, name: row.name, createdAt: row.created_at, fields: fieldsByTag.get(row.id) ?? [],
    }));
  }

  function resolveProperty(all: readonly SemanticPropertyDefinition[], idOrName: string): SemanticPropertyDefinition {
    const property = all.find(candidate => candidate.id === idOrName) ??
      all.find(candidate => semanticNameKey(candidate.name) === safeKey(idOrName));
    if (!property) {
      throw new SemanticLayerError('unknown_property', `没有字段“${idOrName}”`, {
        available: all.map(candidate => candidate.name),
      });
    }
    return property;
  }

  function resolveTag(all: readonly SemanticTagDefinition[], idOrName: string): SemanticTagDefinition {
    const tag = all.find(candidate => candidate.id === idOrName) ??
      all.find(candidate => semanticNameKey(candidate.name) === safeKey(idOrName));
    if (!tag) {
      throw new SemanticLayerError('unknown_tag', `没有标签“${idOrName}”`, {
        available: all.map(candidate => candidate.name),
      });
    }
    return tag;
  }

  function assertNewName(
    kind: 'tag' | 'property',
    name: string,
    existing: readonly { readonly id: string; readonly name: string }[],
    allowSimilar: boolean
  ): void {
    const key = semanticNameKey(name);
    const same = existing.find(item => semanticNameKey(item.name) === key);
    if (same) {
      throw new SemanticLayerError('name_conflict', `已有${kind === 'tag' ? '标签' : '字段'}“${same.name}”`, {
        existing: { id: same.id, name: same.name },
      });
    }
    if (allowSimilar) return;
    const similar = findSimilarSemanticNames(name, existing);
    if (similar.length) {
      throw new SemanticLayerError('similar_name', `已有相近的${kind === 'tag' ? '标签' : '字段'}，确认不是同一个再新建`, {
        candidates: similar.map(item => ({ id: item.id, name: item.name })),
      });
    }
  }

  function normalizeFields(
    fields: readonly SemanticTagField[],
    all: readonly SemanticPropertyDefinition[]
  ): { readonly property: SemanticPropertyDefinition; readonly defaultValue: SemanticValue | undefined }[] {
    const seen = new Set<string>();
    return fields.map(field => {
      const property = resolveProperty(all, field.propertyId);
      if (seen.has(property.id)) {
        throw new SemanticLayerError('invalid_definition', `字段“${property.name}”重复`);
      }
      seen.add(property.id);
      return { property, defaultValue: normalizeSemanticValue(property, field.defaultValue) };
    });
  }

  const insertTagField = db.prepare(
    'INSERT INTO semantic_tag_fields (tag_id, property_id, position, default_json) VALUES (?, ?, ?, ?)'
  );
  function writeTagFields(tagId: string, fields: ReturnType<typeof normalizeFields>): void {
    db.prepare('DELETE FROM semantic_tag_fields WHERE tag_id = ?').run(tagId);
    fields.forEach((field, position) => insertTagField.run(
      tagId, field.property.id, position,
      field.defaultValue === undefined ? null : JSON.stringify(field.defaultValue)
    ));
  }

  function readDraft(ref: SemanticObjectRef): ObjectDraft & { readonly revision: number } {
    const row = readValueRow.get(ref.kind, ref.id);
    return {
      revision: row?.revision ?? 0,
      values: row ? JSON.parse(row.property_values) as Values : {},
      tagIds: readObjectTagIds.all(ref.kind, ref.id).map(item => item.tag_id),
    };
  }

  function project(ref: SemanticObjectRef, revision: number, draft: ObjectDraft): SemanticObjectState {
    const allTags = tags();
    const allProperties = new Map(properties().map(property => [property.id, property]));
    const objectTags = draft.tagIds.flatMap(id => allTags.filter(tag => tag.id === id));
    const fields = new Map<string, SemanticObjectField>();
    for (const tag of objectTags) {
      for (const field of tag.fields) {
        const property = allProperties.get(field.propertyId);
        if (!property) continue;
        const existing = fields.get(property.id);
        fields.set(property.id, { property, tagIds: [...(existing?.tagIds ?? []), tag.id] });
      }
    }
    const values: Values = {};
    for (const id of fields.keys()) if (draft.values[id] !== undefined) values[id] = draft.values[id];
    return { ref, revision, tags: objectTags, fields: [...fields.values()], values };
  }

  /** 读写共用的对象检查；文档必须在调用方的项目内。写入另要求不在回收站。 */
  function admitDocument(projectId: string, ref: SemanticObjectRef, forWrite: boolean) {
    if (ref.kind !== 'document') {
      throw new SemanticLayerError('unsupported_kind', '第一版只支持给文档打标签', { kind: ref.kind });
    }
    const document = documents.read(ref.id);
    if (!document || (forWrite && document.deletedAt !== null)) {
      throw new SemanticLayerError('object_not_found', `找不到文档 ${ref.id}`);
    }
    if (document.projectId !== projectId) {
      throw new SemanticLayerError('outside_project', '文档不在当前项目内');
    }
    if (document.nodeType === 'folder') {
      throw new SemanticLayerError('unsupported_kind', '文件夹不能打标签');
    }
    return document;
  }

  const objectColumns = (ref: SemanticObjectRef) => [
    ref.kind, ref.id, ref.kind === 'document' ? ref.id : null, ref.kind === 'conversation' ? ref.id : null,
  ] as const;

  function commit(
    write: SemanticObjectWrite,
    action: ActionLedgerAction,
    change: (current: ObjectDraft) => ObjectDraft
  ): SemanticObjectState {
    return db.transaction((): SemanticObjectState => {
      const document = admitDocument(write.projectId, write.ref, true);
      const current = readDraft(write.ref);
      if (current.revision !== write.expectedRevision) {
        throw new SemanticLayerError('revision_conflict', '对象已被改过，请重新读取后再写', {
          currentRevision: current.revision, expectedRevision: write.expectedRevision,
        });
      }
      const next = change(current);
      const sameTags = next.tagIds.length === current.tagIds.length &&
        next.tagIds.every(id => current.tagIds.includes(id));
      if (sameTags && sameValues(next.values, current.values)) {
        return project(write.ref, current.revision, current);
      }
      const at = now();
      const revision = current.revision + 1;
      const columns = objectColumns(write.ref);
      const removed = current.tagIds.filter(id => !next.tagIds.includes(id));
      const added = next.tagIds.filter(id => !current.tagIds.includes(id));
      const removeTag = db.prepare('DELETE FROM semantic_object_tags WHERE object_kind = ? AND object_id = ? AND tag_id = ?');
      for (const id of removed) removeTag.run(write.ref.kind, write.ref.id, id);
      const insertTag = db.prepare(`
        INSERT INTO semantic_object_tags (object_kind, object_id, document_id, conversation_id, tag_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      // 标签按打上的先后排序；同一批按传入顺序，created_at 依次加一。
      added.forEach((id, index) => insertTag.run(...columns, id, at + index));
      const valuesJson = JSON.stringify(next.values);
      db.prepare(`
        INSERT INTO semantic_object_values (object_kind, object_id, document_id, conversation_id, revision, property_values, updated_at)
        VALUES (?, ?, ?, ?, ?, jsonb(?), ?)
        ON CONFLICT (object_kind, object_id) DO UPDATE SET
          revision = excluded.revision, property_values = excluded.property_values, updated_at = excluded.updated_at
      `).run(...columns, revision, valuesJson, at);
      db.prepare(`
        INSERT INTO semantic_object_versions (object_kind, object_id, document_id, conversation_id, revision, tag_ids_json, property_values, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, jsonb(?), ?)
      `).run(...columns, revision, JSON.stringify(next.tagIds), valuesJson, at);
      db.prepare(`
        DELETE FROM semantic_object_versions
        WHERE object_kind = ? AND object_id = ? AND revision <= ?
      `).run(write.ref.kind, write.ref.id, revision - KEPT_VERSIONS);
      const actor = currentActionActor();
      if (actor && document.projectId) {
        createSqliteActionLedger(db, { now }).recorderFor(actor, 'fine').record({
          projectId: document.projectId,
          documentId: write.ref.id,
          documentType: document.nodeType,
          action,
          part: 'properties',
          beforeRef: String(current.revision),
          afterRef: String(revision),
          summary: {
            tagsAdded: added.length,
            tagsRemoved: removed.length,
            valuesChanged: changedValueCount(current.values, next.values),
          },
        });
      }
      return project(write.ref, revision, next);
    }).immediate();
  }

  return {
    listProperties: properties,
    listTags: tags,

    /**
     * 一批对象各自的标签，按打标签的先后；给列表一次读出，不逐个 readObject。
     * 不校验对象是否存在或在哪个项目，范围由调用方给出的 ID 决定。
     */
    listObjectTags(kind: SemanticObjectKind, objectIds: readonly string[]): ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]> {
      const wanted = new Set(objectIds);
      const result = new Map<string, { id: string; name: string }[]>();
      if (!wanted.size) return result;
      const rows = db.prepare<[string], { object_id: string; id: string; name: string }>(`
        SELECT object_tag.object_id, tag.id, tag.name FROM semantic_object_tags object_tag
        JOIN semantic_tags tag ON tag.id = object_tag.tag_id AND tag.deleted_at IS NULL
        WHERE object_tag.object_kind = ?
        ORDER BY object_tag.object_id, object_tag.created_at, object_tag.tag_id
      `).all(kind);
      for (const row of rows) {
        if (!wanted.has(row.object_id)) continue;
        const list = result.get(row.object_id) ?? [];
        list.push({ id: row.id, name: row.name });
        result.set(row.object_id, list);
      }
      return result;
    },

    /**
     * 一批对象各自的版本与字段值，只含当前标签带来的字段（与 readObject 一致）；给列表一次读出。
     * 从未写过的对象不在结果里，调用方按版本 0、没有值处理。范围由调用方给出的 ID 决定。
     */
    listObjectValues(kind: SemanticObjectKind, objectIds: readonly string[]): ReadonlyMap<string, { readonly revision: number; readonly values: Readonly<Values> }> {
      const wanted = new Set(objectIds);
      const result = new Map<string, { revision: number; values: Values }>();
      if (!wanted.size) return result;
      const tagIdsByObject = new Map<string, string[]>();
      for (const row of db.prepare<[string], { object_id: string; tag_id: string }>(`
        SELECT object_tag.object_id, object_tag.tag_id FROM semantic_object_tags object_tag
        JOIN semantic_tags tag ON tag.id = object_tag.tag_id AND tag.deleted_at IS NULL
        WHERE object_tag.object_kind = ?
      `).all(kind)) {
        if (!wanted.has(row.object_id)) continue;
        tagIdsByObject.set(row.object_id, [...(tagIdsByObject.get(row.object_id) ?? []), row.tag_id]);
      }
      const fieldsByTag = new Map(tags().map(tag => [tag.id, tag.fields.map(field => field.propertyId)]));
      for (const row of db.prepare<[string], { object_id: string; revision: number; property_values: string }>(`
        SELECT object_id, revision, json(property_values) AS property_values
        FROM semantic_object_values WHERE object_kind = ?
      `).all(kind)) {
        if (!wanted.has(row.object_id)) continue;
        const visible = new Set((tagIdsByObject.get(row.object_id) ?? []).flatMap(id => fieldsByTag.get(id) ?? []));
        const all = JSON.parse(row.property_values) as Values;
        const values: Values = {};
        for (const [id, value] of Object.entries(all)) if (visible.has(id)) values[id] = value;
        result.set(row.object_id, { revision: row.revision, values });
      }
      return result;
    },

    /** 新建前查相近名称，给调用方提示复用。 */
    findSimilar(kind: 'tag' | 'property', name: string) {
      const existing: readonly { readonly id: string; readonly name: string }[] = kind === 'tag' ? tags() : properties();
      return findSimilarSemanticNames(name, existing).map(item => ({ id: item.id, name: item.name }));
    },

    defineProperty(input: DefineSemanticPropertyInput): SemanticPropertyDefinition {
      return db.transaction((): SemanticPropertyDefinition => {
        const name = cleanSemanticName(input.name);
        // 带点的名称留给插件字段（`slides.pageCount`），用户和 Agent 新建的字段不能占用。
        if (name.includes('.')) {
          throw new SemanticLayerError('reserved_name', '字段名不能含“.”：带点的名称留给插件声明的字段');
        }
        if (!SEMANTIC_VALUE_TYPES.includes(input.valueType)) {
          throw new SemanticLayerError('invalid_definition', `不支持的字段类型：${String(input.valueType)}`, {
            valueTypes: [...SEMANTIC_VALUE_TYPES],
          });
        }
        assertNewName('property', name, properties(), input.allowSimilar === true);
        const choice = input.valueType === 'select' || input.valueType === 'multi_select';
        const optionNames = (input.options ?? []).map(cleanSemanticName);
        if (choice && optionNames.length === 0) {
          throw new SemanticLayerError('invalid_definition', '单选、多选字段至少要有一个选项');
        }
        if (!choice && optionNames.length) {
          throw new SemanticLayerError('invalid_definition', '只有单选、多选字段有选项');
        }
        const optionKeys = optionNames.map(option => option.toLowerCase());
        if (new Set(optionKeys).size !== optionKeys.length) {
          throw new SemanticLayerError('invalid_definition', '选项名重复');
        }
        const property: SemanticPropertyDefinition = {
          id: newId(), name, valueType: input.valueType, ownerPluginId: null, createdAt: now(),
          options: optionNames.map(option => ({ id: newId(), name: option })),
        };
        db.prepare(`
          INSERT INTO semantic_properties (id, name, name_key, value_type, options_json, owner_plugin_id, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(property.id, name, semanticNameKey(name), property.valueType, JSON.stringify(property.options), property.createdAt);
        return property;
      }).immediate();
    },

    defineTag(input: DefineSemanticTagInput): SemanticTagDefinition {
      return db.transaction((): SemanticTagDefinition => {
        const name = cleanSemanticName(input.name);
        assertNewName('tag', name, tags(), input.allowSimilar === true);
        const fields = normalizeFields(input.fields ?? [], properties());
        const tag = { id: newId(), name, createdAt: now() };
        db.prepare('INSERT INTO semantic_tags (id, name, name_key, color, created_at) VALUES (?, ?, ?, NULL, ?)')
          .run(tag.id, name, semanticNameKey(name), tag.createdAt);
        writeTagFields(tag.id, fields);
        return tags().find(item => item.id === tag.id) ?? { ...tag, fields: [] };
      }).immediate();
    },

    /** 替换标签带的字段。对象的字段随之实时变化；已存的值不动，字段移回来时恢复显示。 */
    setTagFields(tagIdOrName: string, fields: readonly SemanticTagField[]): SemanticTagDefinition {
      return db.transaction((): SemanticTagDefinition => {
        const tag = resolveTag(tags(), tagIdOrName);
        writeTagFields(tag.id, normalizeFields(fields, properties()));
        return resolveTag(tags(), tag.id);
      }).immediate();
    },

    readObject(projectId: string, ref: SemanticObjectRef): SemanticObjectState {
      admitDocument(projectId, ref, false);
      const draft = readDraft(ref);
      return project(ref, draft.revision, draft);
    },

    /** 打标签：新标签的字段默认值只在对象还没有该值时写一次。 */
    tagObject(write: SemanticObjectWrite, tagIdsOrNames: readonly string[]): SemanticObjectState {
      return commit(write, 'tag', current => {
        const all = tags();
        const adding = tagIdsOrNames.map(item => resolveTag(all, item)).filter(tag => !current.tagIds.includes(tag.id));
        const values = { ...current.values };
        const allProperties = properties();
        for (const tag of adding) {
          for (const field of tag.fields) {
            if (field.defaultValue === undefined || values[field.propertyId] !== undefined) continue;
            const property = allProperties.find(item => item.id === field.propertyId);
            const value = property && normalizeSemanticValue(property, field.defaultValue);
            if (value !== undefined) values[field.propertyId] = value;
          }
        }
        return { tagIds: [...current.tagIds, ...new Set(adding.map(tag => tag.id))], values };
      });
    },

    /** 去掉标签：它带来的字段不再显示，值保留，重新打上即恢复。 */
    untagObject(write: SemanticObjectWrite, tagIdsOrNames: readonly string[]): SemanticObjectState {
      return commit(write, 'untag', current => {
        const all = tags();
        const removing = new Set(tagIdsOrNames.map(item => resolveTag(all, item).id));
        return { tagIds: current.tagIds.filter(id => !removing.has(id)), values: current.values };
      });
    },

    /**
     * 恢复到某个版本的标签与值（0 表示从未打过标签），用于按运行撤回。恢复本身是一次新写入，
     * 也要期望版本、也入账；只保留最近 50 个版本，更早的报错。已删除的标签不会被恢复。
     */
    restoreObject(write: SemanticObjectWrite, toRevision: number): SemanticObjectState {
      return commit(write, 'set_props', () => {
        if (toRevision === 0) return { tagIds: [], values: {} };
        const row = db.prepare<[string, string, number], { tag_ids_json: string; property_values: string }>(`
          SELECT tag_ids_json, json(property_values) AS property_values FROM semantic_object_versions
          WHERE object_kind = ? AND object_id = ? AND revision = ?
        `).get(write.ref.kind, write.ref.id, toRevision);
        if (!row) {
          throw new SemanticLayerError('invalid_value', `版本 ${toRevision} 不在保留范围内（每个对象保留最近 ${KEPT_VERSIONS} 个版本）`);
        }
        const active = new Set(tags().map(tag => tag.id));
        return {
          tagIds: (JSON.parse(row.tag_ids_json) as string[]).filter(id => active.has(id)),
          values: JSON.parse(row.property_values) as Values,
        };
      });
    },

    /** 写字段值：只能写对象当前标签带来的字段；`null`、空字符串、空列表都表示清除。 */
    setValues(write: SemanticObjectWrite, patch: Readonly<Record<string, unknown>>): SemanticObjectState {
      return commit(write, 'set_props', current => {
        const state = project(write.ref, 0, current);
        const available = state.fields.map(field => field.property);
        const values = { ...current.values };
        for (const [key, raw] of Object.entries(patch)) {
          const property = available.find(item => item.id === key) ??
            available.find(item => semanticNameKey(item.name) === safeKey(key));
          if (!property) {
            const defined = properties().some(item => item.id === key || semanticNameKey(item.name) === safeKey(key));
            throw new SemanticLayerError(
              defined ? 'field_not_available' : 'unknown_property',
              defined ? `字段“${key}”不属于这个文档的任何标签` : `没有字段“${key}”`,
              { available: available.map(item => item.name) }
            );
          }
          if (property.ownerPluginId) {
            throw new SemanticLayerError('readonly_property', `字段“${property.name}”由插件维护，只读`);
          }
          const value = normalizeSemanticValue(property, raw);
          if (value === undefined) delete values[property.id];
          else values[property.id] = value;
        }
        return { tagIds: current.tagIds, values };
      });
    },
  };
}

function changedValueCount(before: Values, after: Values): number {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).length;
}

/** 查找时名称不合法就当作找不到，不让查询报“名称不合法”。 */
function safeKey(raw: string): string | null {
  try {
    return semanticNameKey(raw);
  } catch {
    return null;
  }
}

export type SqliteSemanticLayer = ReturnType<typeof createSqliteSemanticLayer>;
