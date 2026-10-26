import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import { DecisionRecordSchema, type DecisionRecord } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';

function readRecord(row: unknown): DecisionRecord {
  if (typeof row !== 'object' || row === null || !('content_json' in row)
    || typeof row.content_json !== 'string') {
    throw new Error('Invalid persisted decision record.');
  }
  const value: unknown = JSON.parse(row.content_json);
  return DecisionRecordSchema.parse(value);
}

/** 只读写本插件表；项目作用域来自 Host，不接受模型提供的数据库路径或项目覆盖。 */
export function createDecisionRecordRepository(database: PluginSqliteDatabasePort, projectId: string) {
  function read(id: string, revision?: number): DecisionRecord {
    const row = revision === undefined
      ? database.prepare(`SELECT content_json FROM decision_record_versions
          WHERE decision_id = ? AND project_id = ? ORDER BY revision DESC LIMIT 1`).get(id, projectId)
      : database.prepare(`SELECT content_json FROM decision_record_versions
          WHERE decision_id = ? AND project_id = ? AND revision = ?`).get(id, projectId, revision);
    if (row === undefined) throw new DecisionFailure('not_found', 'Decision not found in this project.');
    return readRecord(row);
  }

  return {
    read,
    list() {
      return database.prepare(`SELECT v.content_json FROM decision_record_versions v
        WHERE v.project_id = ? AND v.revision = (
          SELECT MAX(latest.revision) FROM decision_record_versions latest
          WHERE latest.decision_id = v.decision_id
        ) ORDER BY v.created_at DESC`).all(projectId).map(readRecord);
    },
    append(record: DecisionRecord, expectedRevision: number) {
      database.transaction(() => {
        if (expectedRevision > 0) {
          const latest = read(record.id);
          if (latest.revision !== expectedRevision) {
            throw new DecisionFailure('revision_conflict', `Revision conflict: expected ${expectedRevision}, current ${latest.revision}. Read the current record before updating.`);
          }
        }
        database.prepare(`INSERT INTO decision_record_versions
          (decision_id, project_id, revision, content_json, created_at) VALUES (?, ?, ?, ?, ?)`)
          .run(record.id, projectId, record.revision, JSON.stringify(record), Date.now());
      }).immediate();
    },
  };
}
