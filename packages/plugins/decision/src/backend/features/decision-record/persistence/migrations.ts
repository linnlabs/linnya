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
}, {
  version: 4, description: 'Explicit unknown dates on historical cash-flow entries',
  up(database) {
    // 旧数组仅表达先后，没有日历事实。迁移保留未知，不能把索引冒充日期，
    // 也不能改变原建议、版本和已导出原件；Host在插件迁移事务内执行此UPDATE。
    database.exec(`UPDATE decision_record_versions SET content_json = json_set(
      CASE WHEN json_type(content_json, '$.model.cashFlows') = 'array' THEN
        json_set(content_json, '$.model.cashFlows', json((
          SELECT json_group_array(json_set(flow.value, '$.timeAnchor', NULL,
            '$.entries', json((SELECT json_group_array(json_set(entry.value, '$.at', NULL))
              FROM json_each(flow.value, '$.entries') entry))))
          FROM json_each(content_json, '$.model.cashFlows') flow
        ))) ELSE content_json END, '$.schemaVersion', 3)
      WHERE json_extract(content_json, '$.schemaVersion') = 2;`);
  },
}, {
  version: 5, description: 'Separate bank balance and segregated reserves without guessing historical cash',
  up(database) {
    // 旧期初有时是银行余额，有时已经扣过准备，不能根据变量名补分类。
    // 原式留在unclassified供重新建模；历史建议、版本及导出字节均不重写。
    database.exec(`UPDATE decision_record_versions SET content_json = json_set(
      CASE WHEN json_type(content_json, '$.model.cashFlows') = 'array' THEN
        json_set(content_json, '$.model.cashFlows', json((
          SELECT json_group_array(json_remove(json_set(flow.value, '$.opening',
            json_object('unclassified', json_extract(flow.value, '$.openingBalance'))), '$.openingBalance'))
          FROM json_each(content_json, '$.model.cashFlows') flow
        ))) ELSE content_json END, '$.schemaVersion', 4)
      WHERE json_extract(content_json, '$.schemaVersion') = 3;`);
  },
}, {
  version: 6, description: 'Payment obligations replace authored cash tables; preserve historical declarations',
  up(database) {
    // 没有登记过责任的旧选项不能被推断成无责任；逐版保留原模型JSON，旧导出不变。
    database.exec(`UPDATE decision_record_versions SET content_json = json_set(content_json,
      '$.schemaVersion', 5,
      '$.legacyPaymentModelJson', printf('%s', json_extract(content_json, '$.model')),
      '$.model', json_remove(json_set(json_extract(content_json, '$.model'),
        '$.obligations', json('[]'),
        '$.options', json((SELECT json_group_array(json_set(value, '$.obligationIds', NULL))
          FROM json_each(content_json, '$.model.options'))),
        '$.checks', json((SELECT json_group_array(json(value))
          FROM json_each(content_json, '$.model.checks')
          WHERE json_extract(value, '$.operator') != 'cash_flow_funded'))), '$.cashFlows'))
      WHERE json_extract(content_json, '$.schemaVersion') = 4;`);
  },
}];
