/**
 * 只读快照：工作区的标签、字段，以及基准项目里每份文档的标签、字段值和保存的筛选。
 * 用 sqlite3 -readonly 打开，不写库；字段值和选项都还原成名称，便于和标准答案比对。
 */
import { execFileSync } from 'node:child_process';

function query(db, sql) {
  const out = execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}

const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export function semanticSnapshot(db, projectIds) {
  const tags = query(db, 'SELECT id, name, created_at FROM semantic_tags WHERE deleted_at IS NULL ORDER BY created_at');
  const properties = query(db, `SELECT id, name, value_type, options_json, created_at
    FROM semantic_properties WHERE deleted_at IS NULL AND owner_plugin_id IS NULL ORDER BY created_at`)
    .map(row => ({ id: row.id, name: row.name, valueType: row.value_type, options: JSON.parse(row.options_json), createdAt: row.created_at }));
  const tagFields = query(db, 'SELECT tag_id, property_id, position FROM semantic_tag_fields ORDER BY tag_id, position');
  const tagName = new Map(tags.map(tag => [tag.id, tag.name]));
  const propertyById = new Map(properties.map(property => [property.id, property]));

  const optionName = (property, value) => {
    const option = property.options.find(item => item && (item.id === value || item.name === value));
    return option ? option.name : value;
  };
  const valueName = (property, value) => {
    if (!property) return value;
    if (Array.isArray(value)) return value.map(item => optionName(property, item));
    return typeof value === 'string' ? optionName(property, value) : value;
  };

  const projects = {};
  for (const projectId of projectIds) {
    const docs = query(db, `SELECT id, name FROM workspace_nodes
      WHERE project_id = ${quote(projectId)} AND deleted_at IS NULL AND type = 'document' ORDER BY name`);
    const ids = docs.map(doc => quote(doc.id)).join(',') || "''";
    const objectTags = query(db, `SELECT object_id, tag_id FROM semantic_object_tags
      WHERE object_kind = 'document' AND object_id IN (${ids})`);
    const values = query(db, `SELECT object_id, revision, json(property_values) AS v FROM semantic_object_values
      WHERE object_kind = 'document' AND object_id IN (${ids})`);
    const filters = query(db, `SELECT name, origin, pinned, definition_json FROM project_saved_filters
      WHERE project_id = ${quote(projectId)} ORDER BY created_at`);
    projects[projectId] = {
      documents: docs.map(doc => {
        const row = values.find(item => item.object_id === doc.id);
        const raw = row ? JSON.parse(row.v) : {};
        const named = {};
        for (const [propertyId, value] of Object.entries(raw)) {
          const property = propertyById.get(propertyId);
          named[property?.name ?? propertyId] = valueName(property, value);
        }
        return {
          name: doc.name,
          tags: objectTags.filter(item => item.object_id === doc.id).map(item => tagName.get(item.tag_id) ?? item.tag_id),
          values: named,
          revision: row?.revision ?? 0,
        };
      }),
      savedFilters: filters.map(filter => ({
        name: filter.name, origin: filter.origin, pinned: Boolean(filter.pinned),
        definition: JSON.parse(filter.definition_json),
      })),
    };
  }

  return {
    tags: tags.map(tag => ({
      name: tag.name,
      fields: tagFields.filter(item => item.tag_id === tag.id).map(item => propertyById.get(item.property_id)?.name ?? item.property_id),
    })),
    properties: properties.map(property => ({
      id: property.id, name: property.name, valueType: property.valueType,
      options: property.options.map(option => option?.name ?? option),
    })),
    projects,
  };
}

export function workspaceTagCount(db) {
  return query(db, 'SELECT count(*) AS n FROM semantic_tags WHERE deleted_at IS NULL')[0].n;
}
