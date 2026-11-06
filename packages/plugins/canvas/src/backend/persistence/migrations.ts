import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

/** 未发布开发态收敛为唯一初始化schema；旧测试数据显式重建，不在读取链保留兼容分支。 */
export const canvasPluginMigrations: readonly PluginMigrationDefinition[] = [
  {
    version: 1,
    description: 'Canvas content, bounded request receipts, approvals and reverse history',
    up(database) {
      database.exec(`
      CREATE TABLE canvas_documents (
        node_id TEXT PRIMARY KEY REFERENCES workspace_nodes(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL DEFAULT 1,
        sequence INTEGER NOT NULL DEFAULT 0,
        next_card INTEGER NOT NULL DEFAULT 1,
        next_edge INTEGER NOT NULL DEFAULT 1,
        maximum_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE canvas_elements (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        element_id TEXT NOT NULL,
        element_json TEXT NOT NULL,
        field_versions_json TEXT NOT NULL,
        field_origins_json TEXT NOT NULL,
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
        status TEXT NOT NULL CHECK(status IN ('pending','committed','denied','replaced','withdrawn','closed')),
        pending_id TEXT, group_id TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, source_key, request_id),
        CHECK ((status = 'committed') = (result_json IS NOT NULL))
      );
      CREATE INDEX canvas_request_recent ON canvas_requests(node_id, group_id);
      CREATE INDEX canvas_request_pending ON canvas_requests(node_id, pending_id);
      CREATE TABLE canvas_editing_claims (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        view_id TEXT NOT NULL,
        element_id TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, view_id, element_id)
      );
      CREATE INDEX canvas_editing_claims_expiry ON canvas_editing_claims(node_id, expires_at);


      CREATE TABLE canvas_history_guards (
        node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
        element_id TEXT NOT NULL, origin TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY(node_id, element_id)
      );
CREATE TABLE canvas_agent_groups (
      node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
      group_id TEXT NOT NULL, source_key TEXT NOT NULL, record_json TEXT NOT NULL,
      PRIMARY KEY(node_id, group_id), UNIQUE(node_id, source_key)
    );
    CREATE TABLE canvas_pending_approvals (
      node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
      pending_id TEXT NOT NULL, group_id TEXT NOT NULL, batch_json TEXT NOT NULL,
      PRIMARY KEY(node_id, pending_id), UNIQUE(node_id, group_id),
      FOREIGN KEY(node_id, group_id) REFERENCES canvas_agent_groups(node_id, group_id) ON DELETE CASCADE
    );

CREATE TABLE canvas_versions (
      node_id TEXT NOT NULL REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
      version_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL, previous_version_id TEXT, state_hash TEXT NOT NULL,
      reverse_blob BLOB, anchor_blob BLOB, asset_ids_json TEXT NOT NULL, restored_from_json TEXT,
      PRIMARY KEY(node_id, version_id), UNIQUE(node_id, sequence)
    );
    CREATE TABLE canvas_version_heads (
      node_id TEXT PRIMARY KEY REFERENCES canvas_documents(node_id) ON DELETE CASCADE,
      latest_version_id TEXT NOT NULL, head_sequence INTEGER NOT NULL, changed_at INTEGER NOT NULL,
      dirty_since INTEGER, reverse_blob BLOB, bytes_since_anchor INTEGER NOT NULL DEFAULT 0,
      used_bytes INTEGER NOT NULL DEFAULT 0, over_budget_bytes INTEGER NOT NULL DEFAULT 0
    );`);
    },
  },
];
