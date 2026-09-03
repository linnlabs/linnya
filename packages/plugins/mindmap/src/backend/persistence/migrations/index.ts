import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';
import {
  MINDMAP_PLUGIN_META,
  normalizeMindmap,
  serializeMindmapToMarkdownOutline,
} from '@plugin/mindmap/shared';

import { MINDMAP_EVIDENCE_SCHEMAS } from '../mindmap_document/schemas/blocks/evidence.schema';
import { MINDMAP_DOCUMENT_SCHEMAS } from '../mindmap_document/schemas/core.schema';

interface MindmapSnapshotBackfillRow {
  readonly node_id: string;
  readonly content_json: string;
  readonly fallback_name: string;
  readonly updated_at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMindmapSnapshotBackfillRow(value: unknown): value is MindmapSnapshotBackfillRow {
  return isRecord(value) &&
    typeof value.node_id === 'string' &&
    typeof value.content_json === 'string' &&
    typeof value.fallback_name === 'string' &&
    typeof value.updated_at === 'number';
}

function buildSnapshotText(contentJson: string, fallbackName: string): string {
  try {
    const parsed: unknown = JSON.parse(contentJson);
    return serializeMindmapToMarkdownOutline(normalizeMindmap(parsed, fallbackName));
  } catch {
    // 中文说明：历史库里可能有早期脏 JSON。快照是降级读取能力，不能因为单条坏数据阻断插件启动。
    return `# ${fallbackName}`;
  }
}

export const mindmapPluginMigrations: readonly PluginMigrationDefinition[] = [
  {
    version: 1,
    description: 'baseline adoption',
    up: (db) => {
      // 中文说明：v1 是基线收养迁移；表已存在时只落 plugin_migrations 账本，不搬数据。
      for (const ddl of [...MINDMAP_DOCUMENT_SCHEMAS, ...MINDMAP_EVIDENCE_SCHEMAS]) {
        db.exec(ddl);
      }
    },
  },
  {
    version: 2,
    description: 'workspace text snapshot backfill',
    up: (db) => {
      const now = Date.now();
      const readRows = db.prepare(`
        SELECT
          v.node_id,
          v.content_json,
          COALESCE(NULLIF(wn.name, ''), NULLIF(v.root_topic, ''), v.node_id) AS fallback_name,
          COALESCE(v.updated_at, wn.updated_at, ?) AS updated_at
        FROM mindmap_versions v
        INNER JOIN (
          SELECT node_id, MAX(version_number) AS version_number
          FROM mindmap_versions
          GROUP BY node_id
        ) latest
          ON latest.node_id = v.node_id
         AND latest.version_number = v.version_number
        LEFT JOIN workspace_nodes wn
          ON wn.id = v.node_id
        WHERE NOT EXISTS (
          SELECT 1
          FROM workspace_node_text_snapshots s
          WHERE s.node_id = v.node_id
        )
      `).all;
      if (!readRows) {
        throw new Error('Mindmap 文本快照回填缺少数据库查询能力。');
      }
      const rows = readRows(now);

      const saveSnapshot = db.prepare(`
        INSERT INTO workspace_node_text_snapshots (
          node_id,
          content_type,
          text,
          source_plugin_id,
          source_node_type,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          content_type = excluded.content_type,
          text = excluded.text,
          source_plugin_id = excluded.source_plugin_id,
          source_node_type = excluded.source_node_type,
          updated_at = excluded.updated_at
      `);
      const runSaveSnapshot = saveSnapshot.run;
      if (!runSaveSnapshot) {
        throw new Error('Mindmap 文本快照回填缺少数据库写入能力。');
      }

      for (const row of rows) {
        if (!isMindmapSnapshotBackfillRow(row)) {
          throw new Error('Mindmap 文本快照回填读取到异常行结构。');
        }
        runSaveSnapshot(
          row.node_id,
          'text/markdown',
          buildSnapshotText(row.content_json, row.fallback_name),
          MINDMAP_PLUGIN_META.id,
          'mindmap',
          row.updated_at,
        );
      }
    },
  },
] as const;
