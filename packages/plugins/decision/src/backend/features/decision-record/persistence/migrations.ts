import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

export const decisionMigrations: readonly PluginMigrationDefinition[] = [{
  version: 1,
  description: 'Versioned project decision records',
  up(database) {
    database.exec(`CREATE TABLE IF NOT EXISTS decision_record_versions (
      decision_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (decision_id, revision)
    );
    CREATE INDEX IF NOT EXISTS decision_record_project
      ON decision_record_versions(project_id, decision_id, revision);`);
  },
}, {
  version: 2, description: 'Version-bound managed research requests',
  up(database) {
    database.exec(`CREATE TABLE decision_research_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      decision_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX decision_research_project ON decision_research_jobs(project_id, decision_id);`);
  },
}, {
  version: 3, description: 'Explicit quantity types for all persisted decision revisions',
  up(database) {
    // 单条UPDATE原子迁移全部历史。只保留旧合同唯一明确的钟点声明，其他一律other；
    // 不根据CNY、min或名称猜类型，不重算/修改旧建议、版本、来源和已导出文件。
    database.exec(`UPDATE decision_record_versions SET content_json = json_set(content_json,
      '$.schemaVersion', 2,
      '$.model.inputs', json((SELECT json_group_array(json_set(value, '$.quantityType',
        CASE WHEN json_extract(value, '$.unit') = '当天00:00起分钟' THEN 'day_clock' ELSE 'other' END))
        FROM json_each(content_json, '$.model.inputs'))),
      '$.model.calculations', json((SELECT json_group_array(json_set(value, '$.quantityType',
        CASE WHEN json_extract(value, '$.unit') = '当天00:00起分钟' THEN 'day_clock' ELSE 'other' END))
        FROM json_each(content_json, '$.model.calculations'))))
      WHERE json_extract(content_json, '$.schemaVersion') = 1;`);
  },
}];
