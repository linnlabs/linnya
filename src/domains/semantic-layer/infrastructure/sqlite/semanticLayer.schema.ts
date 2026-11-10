/**
 * 语义层表。定义是工作区级的；对象按（种类，ID）挂标签和值。
 *
 * 每种对象各有一列外键（document_id、conversation_id），只有与种类相符的那一列有值：
 * 文档或对话被物理删除时（回收站清空、项目删除等任何路径）标签与值随之级联删除，
 * 不依赖各 owner 记得调用清理。新增种类时加一列外键与 CHECK。
 * 值每对象一行 JSONB（万级对象任意字段扫描 1–5ms，不为字段建索引）。
 */
const objectColumns = `
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    document_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE CASCADE`;
// 表约束必须写在全部列之后。
const objectCheck = `
    CHECK ((object_kind = 'document' AND document_id = object_id AND conversation_id IS NULL)
      OR (object_kind = 'conversation' AND conversation_id = object_id AND document_id IS NULL))`;

export const SEMANTIC_LAYER_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS semantic_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    color TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_tags_name_key
    ON semantic_tags(name_key) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS semantic_properties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    value_type TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    owner_plugin_id TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_properties_name_key
    ON semantic_properties(name_key) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS semantic_tag_fields (
    tag_id TEXT NOT NULL REFERENCES semantic_tags(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL REFERENCES semantic_properties(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    default_json TEXT,
    PRIMARY KEY (tag_id, property_id)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS semantic_object_tags (${objectColumns},
    tag_id TEXT NOT NULL REFERENCES semantic_tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,${objectCheck},
    PRIMARY KEY (object_kind, object_id, tag_id)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_tags_tag
    ON semantic_object_tags(tag_id, object_kind, object_id)`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_tags_document
    ON semantic_object_tags(document_id) WHERE document_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_tags_conversation
    ON semantic_object_tags(conversation_id) WHERE conversation_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS semantic_object_values (${objectColumns},
    revision INTEGER NOT NULL,
    property_values BLOB NOT NULL,
    updated_at INTEGER NOT NULL,${objectCheck},
    PRIMARY KEY (object_kind, object_id)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_values_document
    ON semantic_object_values(document_id) WHERE document_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_values_conversation
    ON semantic_object_values(conversation_id) WHERE conversation_id IS NOT NULL`,
  // 账本的改前、改后版本引用指向这里，按运行撤回时据此恢复；每个对象只留最近 50 个版本。
  `CREATE TABLE IF NOT EXISTS semantic_object_versions (${objectColumns},
    revision INTEGER NOT NULL,
    tag_ids_json TEXT NOT NULL,
    property_values BLOB NOT NULL,
    recorded_at INTEGER NOT NULL,${objectCheck},
    PRIMARY KEY (object_kind, object_id, revision)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_versions_document
    ON semantic_object_versions(document_id) WHERE document_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_semantic_object_versions_conversation
    ON semantic_object_versions(conversation_id) WHERE conversation_id IS NOT NULL`,
] as const;
