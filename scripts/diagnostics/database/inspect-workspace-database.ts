/**
 * @file scripts/diagnostics/database/inspect-workspace-database.ts
 * @description 只读检查 workspace.sqlite 的基础状态。
 *
 * 中文说明：
 * - 这个工具只读打开 SQLite，不执行 DatabaseService.initialize()，避免“检查”动作隐式迁移数据库；
 * - 默认检查开发库（`LINNYA_DEV_MODE=true`）。如需按生产路径检查，可传 `--prod`；
 * - 必须通过 Electron runner 执行，避免 better-sqlite3 ABI 被普通 Node runtime 污染。
 */

import path from 'path';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from 'src/electron-main/services/database/migrations';

const args = new Set(process.argv.slice(2));
if (!args.has('--prod') && process.env.LINNYA_DEV_MODE === undefined) {
  process.env.LINNYA_DEV_MODE = 'true';
}

const { getWorkspaceDataPath } = await import('src/shared/utils/pathManager');

interface CountRow {
  readonly count: number;
}

interface IntegrityRow {
  readonly integrityCheck: string;
}

interface DuplicateNameRow {
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly name: string;
  readonly count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCountRow(value: unknown): CountRow {
  if (isRecord(value) && typeof value.count === 'number') {
    return { count: value.count };
  }
  throw new Error('Unexpected count row returned from SQLite.');
}

function readIntegrityRow(value: unknown): IntegrityRow {
  if (isRecord(value) && typeof value.integrityCheck === 'string') {
    return { integrityCheck: value.integrityCheck };
  }
  throw new Error('Unexpected integrity_check row returned from SQLite.');
}

function readDuplicateRows(value: unknown[]): DuplicateNameRow[] {
  return value.map((row) => {
    if (
      isRecord(row)
      && (typeof row.projectId === 'string' || row.projectId === null)
      && (typeof row.parentId === 'string' || row.parentId === null)
      && typeof row.name === 'string'
      && typeof row.count === 'number'
    ) {
      return {
        projectId: row.projectId,
        parentId: row.parentId,
        name: row.name,
        count: row.count,
      };
    }
    throw new Error('Unexpected duplicate-name row returned from SQLite.');
  });
}

function readTableNames(db: Database.Database): Set<string> {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
  `).all();

  const tableNames = new Set<string>();
  for (const row of rows) {
    if (isRecord(row) && typeof row.name === 'string') {
      tableNames.add(row.name);
      continue;
    }
    throw new Error('Unexpected sqlite_master row returned from SQLite.');
  }
  return tableNames;
}

function readCount(db: Database.Database, tableNames: Set<string>, tableName: string): number | null {
  if (!tableNames.has(tableName)) return null;
  const quotedTableName = tableName.replace(/"/g, '""');
  return readCountRow(db.prepare(`SELECT COUNT(*) AS count FROM "${quotedTableName}"`).get()).count;
}

function readUserVersion(db: Database.Database): number {
  const value: unknown = db.pragma('user_version', { simple: true });
  if (typeof value !== 'number') {
    throw new Error('Unexpected user_version value returned from SQLite.');
  }
  return value;
}

function readDuplicateActiveSiblingNames(db: Database.Database, tableNames: Set<string>): DuplicateNameRow[] {
  if (!tableNames.has('workspace_nodes')) return [];

  return readDuplicateRows(db.prepare(`
    SELECT
      project_id AS projectId,
      parent_id AS parentId,
      name,
      COUNT(*) AS count
    FROM workspace_nodes
    WHERE deleted_at IS NULL
    GROUP BY project_id, parent_id, name
    HAVING COUNT(*) > 1
    ORDER BY count DESC, name ASC
  `).all());
}

function main(): void {
  const dbPath = path.join(getWorkspaceDataPath(), 'workspace.sqlite');
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const tableNames = readTableNames(db);
    const summary = {
      dbPath,
      mode: process.env.LINNYA_DEV_MODE === 'true' ? 'development' : 'production',
      schemaVersion: {
        current: readUserVersion(db),
        expected: SCHEMA_VERSION,
      },
      integrityCheck: readIntegrityRow(db.prepare(`
        SELECT integrity_check AS integrityCheck
        FROM pragma_integrity_check
      `).get()).integrityCheck,
      counts: {
        projects: readCount(db, tableNames, 'projects'),
        workspaceNodes: readCount(db, tableNames, 'workspace_nodes'),
        activeWorkspaceNodes: tableNames.has('workspace_nodes')
          ? readCountRow(db.prepare('SELECT COUNT(*) AS count FROM workspace_nodes WHERE deleted_at IS NULL').get()).count
          : null,
        markdownDocuments: readCount(db, tableNames, 'markdown_documents'),
        conversations: readCount(db, tableNames, 'conversations'),
        events: readCount(db, tableNames, 'events'),
      },
      duplicateActiveSiblingNames: readDuplicateActiveSiblingNames(db, tableNames),
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.close();
  }
}

main();
