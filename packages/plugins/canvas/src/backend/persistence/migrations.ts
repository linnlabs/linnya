import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

export const canvasPluginMigrations: readonly PluginMigrationDefinition[] = [{
  version: 1,
  description: 'Canvas current content, atomic receipts and field history',
  up(database) {
    database.exec(`
      CREATE TABLE canvas_documents (
        node_id TEXT PRIMARY KEY REFERENCES workspace_nodes(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL DEFAULT 1,
        sequence INTEGER NOT NULL DEFAULT 0,
        next_card INTEGER NOT NULL DEFAULT 1,
        next_edge INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE canvas_elements (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        element_id TEXT NOT NULL,
        element_json TEXT NOT NULL,
        field_versions_json TEXT NOT NULL,
        PRIMARY KEY (node_id, element_id)
      );
      CREATE TABLE canvas_changes (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        changes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, sequence)
      );
      CREATE TABLE canvas_requests (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        source_key TEXT NOT NULL,
        request_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, source_key, request_id)
      );
      CREATE TABLE canvas_editing_claims (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        view_id TEXT NOT NULL,
        element_id TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, view_id, element_id)
      );
      CREATE INDEX canvas_editing_claims_expiry ON canvas_editing_claims(node_id, expires_at);
    `);
  },
}, {
  version: 2,
  description: 'Separate monotonic field versions from logical undo origins',
  up(database) {
    database.exec(`ALTER TABLE canvas_elements ADD COLUMN field_origins_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE canvas_history_guards (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        element_id TEXT NOT NULL, origin TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY(node_id, element_id)
      );`);
  },
}];
