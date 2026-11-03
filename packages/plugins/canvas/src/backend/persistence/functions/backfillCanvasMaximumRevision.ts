import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { PluginMigrationDatabase } from '@plugin/backend/pluginMigration';

const revisionSchema = z.number().int().nonnegative();
const elementFactSchema = z.object({ schemaVersion: z.literal(1), revision: revisionSchema });

function jsonFact(value: string): unknown {
  try { const parsed: unknown = JSON.parse(value); return parsed; }
  catch { return undefined; }
}
function compressedFact(value: unknown): unknown {
  if (!(value instanceof Uint8Array)) return undefined;
  // 迁移只提取已知修订事实，不修复正文；损坏历史仍留给只读/预览准入报告。
  try { return jsonFact(gunzipSync(value).toString('utf8')); }
  catch { return undefined; }
}
function elementRevision(value: unknown): number {
  const fact = elementFactSchema.safeParse(value);
  return fact.success ? fact.data.revision : 0;
}
function anchorRevision(value: unknown): number {
  const snapshot = z.object({ schemaVersion: z.literal(1), elements: z.array(z.unknown()) }).safeParse(value);
  return snapshot.success ? snapshot.data.elements.reduce<number>((maximum, element) => Math.max(maximum, elementRevision(element)), 0) : 0;
}
function inverseRevision(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let maximum = 0;
  for (const item of value) {
    const row = z.object({ kind: z.string(), element: z.unknown().optional(), fields: z.unknown().optional() }).safeParse(item);
    if (!row.success) continue;
    if (row.data.kind === 'put') maximum = Math.max(maximum, elementRevision(row.data.element));
    if (row.data.kind === 'patch') {
      const fields = z.object({ revision: revisionSchema.optional() }).safeParse(row.data.fields);
      if (fields.success && fields.data.revision !== undefined) maximum = Math.max(maximum, fields.data.revision);
    }
  }
  return maximum;
}

/** 已发布前的开发数据没有标量；从尚可读取的当前/guard/历史事实一次性补齐。 */
export function backfillCanvasMaximumRevision(database: Pick<PluginMigrationDatabase, 'prepare'>): void {
  const documents = database.prepare('SELECT node_id, schema_version FROM canvas_documents').all();
  for (const value of documents) {
    const document = z.object({ node_id: z.string(), schema_version: z.number().int() }).parse(value);
    if (document.schema_version !== 1) continue;
    let maximum = 0;
    for (const value of database.prepare('SELECT element_json FROM canvas_elements WHERE node_id = ?').all(document.node_id)) {
      const row = z.object({ element_json: z.string() }).parse(value);
      maximum = Math.max(maximum, elementRevision(jsonFact(row.element_json)));
    }
    for (const value of database.prepare('SELECT revision FROM canvas_history_guards WHERE node_id = ?').all(document.node_id)) {
      const row = z.object({ revision: revisionSchema }).safeParse(value);
      if (row.success) maximum = Math.max(maximum, row.data.revision);
    }
    for (const value of database.prepare('SELECT anchor_blob, reverse_blob FROM canvas_versions WHERE node_id = ? AND schema_version = 1').all(document.node_id)) {
      const row = z.object({ anchor_blob: z.unknown(), reverse_blob: z.unknown() }).parse(value);
      maximum = Math.max(maximum, anchorRevision(compressedFact(row.anchor_blob)), inverseRevision(compressedFact(row.reverse_blob)));
    }
    for (const value of database.prepare('SELECT reverse_blob FROM canvas_version_heads WHERE node_id = ?').all(document.node_id)) {
      const row = z.object({ reverse_blob: z.unknown() }).parse(value);
      maximum = Math.max(maximum, inverseRevision(compressedFact(row.reverse_blob)));
    }
    database.prepare('UPDATE canvas_documents SET maximum_revision = MAX(maximum_revision, ?) WHERE node_id = ?').run(maximum, document.node_id);
  }
}
