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
}];
